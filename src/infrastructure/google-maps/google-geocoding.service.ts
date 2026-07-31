import { BadGatewayException, Injectable } from '@nestjs/common';

export interface ResolveAddressInput {
  query?: string;
  placeId?: string;
  lat?: number;
  lng?: number;
}

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
      results?: Array<{
        place_id: string;
        formatted_address: string;
        geometry: { location: { lat: number; lng: number } };
        address_components?: Array<{
          long_name: string;
          short_name: string;
          types: string[];
        }>;
      }>;
    };
    const result = body.results?.[0];
    if (!result) {
      throw new BadGatewayException(
        `Google geocoding returned no result (${body.status ?? 'unknown'})`,
      );
    }
    return this.toAddress(result);
  }

  private toAddress(result: {
    place_id: string;
    formatted_address: string;
    geometry: { location: { lat: number; lng: number } };
    address_components?: Array<{
      long_name: string;
      short_name: string;
      types: string[];
    }>;
  }) {
    const component = (type: string, short = false) => {
      const found = result.address_components?.find((item) =>
        item.types.includes(type),
      );
      return short ? found?.short_name : found?.long_name;
    };
    return {
      placeId: result.place_id,
      formattedAddress: result.formatted_address,
      latitude: result.geometry.location.lat,
      longitude: result.geometry.location.lng,
      buildingNo: component('street_number'),
      street: component('route'),
      district:
        component('sublocality') ?? component('administrative_area_level_2'),
      city: component('locality') ?? component('administrative_area_level_1'),
      stateCode: component('administrative_area_level_1', true),
      postalCode: component('postal_code'),
      countryCode: component('country', true),
      source: 'google' as const,
    };
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
    return {
      placeId: input.placeId ?? `stub-${hash.toString(16)}`,
      formattedAddress: input.query?.trim() || 'Riyadh, Saudi Arabia',
      latitude,
      longitude,
      city: 'Riyadh',
      stateCode: 'RY',
      countryCode: 'SA',
      source: 'stub' as const,
    };
  }
}
