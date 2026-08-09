import { BadGatewayException, Injectable } from '@nestjs/common';

export interface ResolveAddressInput {
  query?: string;
  placeId?: string;
  lat?: number;
  lng?: number;
}

type AddressComponent = {
  long_name: string;
  short_name: string;
  types: string[];
};

type GeocodeResult = {
  place_id: string;
  formatted_address: string;
  types?: string[];
  geometry: { location: { lat: number; lng: number } };
  address_components?: AddressComponent[];
};

const PLACE_TYPES = [
  'establishment',
  'point_of_interest',
  'premise',
  'tourist_attraction',
  'shopping_mall',
  'store',
];

@Injectable()
export class GoogleGeocodingService {
  async resolve(input: ResolveAddressInput) {
    const apiKey = process.env.GOOGLE_MAPS_API_KEY?.trim();
    if (!apiKey) return this.stub(input);

    const params = new URLSearchParams({ key: apiKey });
    if (input.placeId) params.set('place_id', input.placeId);
    else if (input.lat != null && input.lng != null) {
      params.set('latlng', `${input.lat},${input.lng}`);
    } else if (input.query) params.set('address', input.query);
    else return this.stub(input);

    const response = await fetch(
      `https://maps.googleapis.com/maps/api/geocode/json?${params.toString()}`,
    );
    if (!response.ok) {
      throw new BadGatewayException('Google geocoding request failed');
    }
    const body = (await response.json()) as {
      status?: string;
      results?: GeocodeResult[];
    };
    const results = Array.isArray(body.results) ? body.results : [];
    if (!results.length) {
      throw new BadGatewayException(
        `Google geocoding returned no result (${body.status ?? 'unknown'})`,
      );
    }
    const address = this.toAddress(results);
    if (
      !address.placeName &&
      input.lat != null &&
      input.lng != null &&
      !input.placeId
    ) {
      const nearbyName = await this.nearbyPlaceName(
        apiKey,
        Number(address.latitude),
        Number(address.longitude),
      );
      if (nearbyName) {
        return {
          ...address,
          placeName: nearbyName,
          name: nearbyName,
          landmark: nearbyName,
        };
      }
    }
    return address;
  }

  private async nearbyPlaceName(apiKey: string, lat: number, lng: number) {
    try {
      const params = new URLSearchParams({
        key: apiKey,
        location: `${lat},${lng}`,
        rankby: 'distance',
        type: 'establishment',
      });
      const response = await fetch(
        `https://maps.googleapis.com/maps/api/place/nearbysearch/json?${params.toString()}`,
      );
      if (!response.ok) return undefined;
      const body = (await response.json()) as {
        results?: Array<{ name?: string; vicinity?: string; geometry?: { location?: { lat: number; lng: number } } }>;
      };
      const place = body.results?.[0];
      const name = place?.name?.trim();
      if (!place || !name) return undefined;
      const placeLat = place.geometry?.location?.lat;
      const placeLng = place.geometry?.location?.lng;
      if (placeLat == null || placeLng == null) return name;
      const distanceM = this.haversineMeters(lat, lng, placeLat, placeLng);
      // Only adopt nearby POI names that are essentially under the pin.
      return distanceM <= 80 ? name : undefined;
    } catch {
      return undefined;
    }
  }

  private haversineMeters(
    lat1: number,
    lng1: number,
    lat2: number,
    lng2: number,
  ) {
    const toRad = (deg: number) => (deg * Math.PI) / 180;
    const earth = 6371000;
    const dLat = toRad(lat2 - lat1);
    const dLng = toRad(lng2 - lng1);
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
    return 2 * earth * Math.asin(Math.sqrt(a));
  }

  private toAddress(results: GeocodeResult[]) {
    const placeResult =
      results.find((result) =>
        (result.types ?? []).some((type) => PLACE_TYPES.includes(type)),
      ) ?? null;
    const streetResult =
      results.find((result) =>
        (result.types ?? []).some((type) =>
          ['street_address', 'premise', 'subpremise', 'route'].includes(type),
        ),
      ) ?? results[0];
    const primary = placeResult ?? streetResult;
    const components = this.mergeComponents(results);

    const component = (type: string, short = false) => {
      const found = components.find((item) => item.types.includes(type));
      return short ? found?.short_name : found?.long_name;
    };

    const placeName =
      this.placeNameFromResult(placeResult) ||
      component('premise') ||
      component('establishment') ||
      undefined;

    const buildingNo = component('street_number');
    const street = component('route');
    const secondary = component('subpremise');
    const neighborhood = component('neighborhood');
    const district =
      component('sublocality_level_1') ||
      component('sublocality') ||
      neighborhood ||
      component('administrative_area_level_2');
    const city =
      component('locality') ||
      component('postal_town') ||
      component('administrative_area_level_2');
    const stateLong = component('administrative_area_level_1');
    const stateCode = component('administrative_area_level_1', true);
    const postalCode = component('postal_code');
    const countryCode = component('country', true);
    const country = component('country');

    return {
      placeId: primary.place_id,
      placeName: placeName || undefined,
      name: placeName || undefined,
      landmark: placeName || undefined,
      formattedAddress: primary.formatted_address,
      latitude: primary.geometry.location.lat,
      longitude: primary.geometry.location.lng,
      buildingNo: buildingNo || undefined,
      street: street || undefined,
      secondary: secondary || undefined,
      neighborhood: neighborhood || undefined,
      district: district || undefined,
      city: city || undefined,
      stateProvince: stateLong || undefined,
      stateCode: stateCode || undefined,
      postalCode: postalCode || undefined,
      countryCode: countryCode || undefined,
      country: country || undefined,
      source: 'google' as const,
    };
  }

  private placeNameFromResult(result: GeocodeResult | null) {
    if (!result) return undefined;
    const types = result.types ?? [];
    if (!types.some((type) => PLACE_TYPES.includes(type))) return undefined;
    const name = result.formatted_address.split(',')[0]?.trim();
    return name || undefined;
  }

  private mergeComponents(results: GeocodeResult[]) {
    const preferred: AddressComponent[] = [];
    const seenTypes = new Set<string>();
    for (const result of results) {
      for (const component of result.address_components ?? []) {
        const freshTypes = component.types.filter((type) => !seenTypes.has(type));
        if (!freshTypes.length) continue;
        preferred.push(component);
        for (const type of component.types) seenTypes.add(type);
      }
    }
    return preferred;
  }

  private stub(input: ResolveAddressInput) {
    const seed =
      input.query?.trim() ||
      input.placeId?.trim() ||
      `${input.lat ?? 24.7136},${input.lng ?? 46.6753}`;
    let hash = 0;
    for (const char of seed) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
    const latitude =
      input.lat ?? Math.round((24.6 + (hash % 2000) / 10000) * 1e6) / 1e6;
    const longitude =
      input.lng ??
      Math.round((46.6 + ((hash >>> 8) % 2000) / 10000) * 1e6) / 1e6;
    const placeName =
      input.query?.trim()?.split(',')[0]?.trim() || undefined;
    return {
      placeId: input.placeId ?? `stub-${hash.toString(16)}`,
      placeName,
      name: placeName,
      landmark: placeName,
      formattedAddress: input.query?.trim() || 'Riyadh, Saudi Arabia',
      latitude,
      longitude,
      city: 'Riyadh',
      stateProvince: 'Riyadh',
      stateCode: 'RY',
      countryCode: 'SA',
      country: 'Saudi Arabia',
      source: 'stub' as const,
    };
  }
}
