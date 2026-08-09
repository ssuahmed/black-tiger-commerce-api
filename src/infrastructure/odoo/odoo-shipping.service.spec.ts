import { ConfigService } from '@nestjs/config';
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

  it('returns vehicle catalog fixtures in mock mode', async () => {
    odoo.isConfigured.mockReturnValue(false);
    const opts = await service.getStorefrontOptions();
    expect(opts.length).toBe(5);
    expect(opts[0].id).toBe('pickup-3t');
    expect(opts.map((o) => o.price.amount)).toEqual([500, 1000, 1500, 2000, 2500]);
  });

  it('returns Odoo vehicle options in live mode', async () => {
    odoo.isConfigured.mockReturnValue(true);
    odoo.executeKw.mockResolvedValue([
      {
        id: 'pickup-3t',
        label: 'Pick-up',
        etaDays: 5,
        price: { currency: 'SAR', amount: 500, formatted: '500 SAR' },
      },
    ]);
    const opts = await service.getStorefrontOptions();
    expect(opts).toHaveLength(1);
    expect(opts[0].id).toBe('pickup-3t');
    expect(odoo.executeKw).toHaveBeenCalled();
  });

  it('serves memory cache on second live call', async () => {
    odoo.isConfigured.mockReturnValue(true);
    odoo.executeKw.mockResolvedValue([
      {
        id: 'medium-rigid-6w',
        label: 'Medium',
        etaDays: 5,
        price: { currency: 'SAR', amount: 1000, formatted: '1,000 SAR' },
      },
    ]);
    await service.getStorefrontOptions();
    await service.getStorefrontOptions();
    expect(odoo.executeKw).toHaveBeenCalledTimes(1);
  });

  it('falls back to vehicle catalog when Odoo returns only removed options', async () => {
    odoo.isConfigured.mockReturnValue(true);
    odoo.executeKw.mockResolvedValue([
      {
        id: 'pallet-standard',
        label: 'Std',
        etaDays: 5,
        price: { currency: 'SAR', amount: 450, formatted: '450 SAR' },
      },
    ]);
    const opts = await service.getStorefrontOptions();
    expect(opts.length).toBe(5);
    expect(opts[0].id).toBe('pickup-3t');
  });
});
