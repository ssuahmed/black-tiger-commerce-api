import { ConfigService } from '@nestjs/config';
import { ServiceUnavailableException } from '@nestjs/common';
import { OdooClient } from '../odoo/odoo.client';
import { RedisService } from '../redis/redis.module';
import { OdooShippingService } from '../odoo/odoo-shipping.service';

describe('OdooShippingService', () => {
  const odoo = { isConfigured: jest.fn(), executeKw: jest.fn() };
  const redis = {
    enabled: false,
    get: jest.fn(),
    setex: jest.fn(),
    del: jest.fn(),
  };
  const config = { get: jest.fn() };
  let service: OdooShippingService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new OdooShippingService(
      odoo as unknown as OdooClient,
      redis as unknown as RedisService,
      config as unknown as ConfigService,
    );
  });

  it('returns fixture options in mock mode', async () => {
    odoo.isConfigured.mockReturnValue(false);
    const opts = await service.getStorefrontOptions();
    expect(opts.length).toBe(2);
    expect(opts[0].id).toBe('pallet-standard');
  });

  it('returns Odoo options in live mode', async () => {
    odoo.isConfigured.mockReturnValue(true);
    odoo.executeKw.mockResolvedValue([
      { id: 'pallet-standard', label: 'Std', etaDays: 5, price: { currency: 'SAR', amount: 450, formatted: '450 SAR' } },
    ]);
    const opts = await service.getStorefrontOptions();
    expect(opts).toHaveLength(1);
    expect(odoo.executeKw).toHaveBeenCalled();
  });

  it('serves memory cache on second live call', async () => {
    odoo.isConfigured.mockReturnValue(true);
    odoo.executeKw.mockResolvedValue([
      { id: 'pallet-standard', label: 'Std', etaDays: 5, price: { currency: 'SAR', amount: 450, formatted: '450 SAR' } },
    ]);
    await service.getStorefrontOptions();
    await service.getStorefrontOptions();
    expect(odoo.executeKw).toHaveBeenCalledTimes(1);
  });

  it('throws in live mode when Odoo returns empty list', async () => {
    odoo.isConfigured.mockReturnValue(true);
    odoo.executeKw.mockResolvedValue([]);
    await expect(service.getStorefrontOptions()).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });
});
