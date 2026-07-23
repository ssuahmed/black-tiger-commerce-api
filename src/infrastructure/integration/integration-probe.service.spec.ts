import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { IntegrationProbeService } from './integration-probe.service';
import { CatalogProductsProvider } from '../../modules/catalog/catalog-products.provider';
import { ContentService } from '../../modules/content/content.service';
import { OdooClient } from '../odoo/odoo.client';
import { OdooShippingService } from '../odoo/odoo-shipping.service';

describe('IntegrationProbeService', () => {
  const odoo = { isConfigured: jest.fn() };
  const catalog = { getSnapshot: jest.fn() };
  const content = { listPages: jest.fn() };
  const shipping = { getStorefrontOptions: jest.fn() };

  let probe: IntegrationProbeService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module = await Test.createTestingModule({
      providers: [
        IntegrationProbeService,
        { provide: ConfigService, useValue: { get: jest.fn() } },
        { provide: OdooClient, useValue: odoo },
        { provide: CatalogProductsProvider, useValue: catalog },
        { provide: ContentService, useValue: content },
        { provide: OdooShippingService, useValue: shipping },
      ],
    }).compile();
    probe = module.get(IntegrationProbeService);
  });

  it('reports ready in mock mode', async () => {
    odoo.isConfigured.mockReturnValue(false);
    catalog.getSnapshot.mockResolvedValue({
      source: 'mock',
      productsBySlug: { a: { packagingOptions: [{ id: 'pkg-box-1' }], imageUrl: 'x' } },
    });
    content.listPages.mockResolvedValue([{ slug: 'home', name: 'Home', published: true }]);
    shipping.getStorefrontOptions.mockResolvedValue([{ id: 'pallet-standard' }]);
    const result = await probe.probe();
    expect(result.status).toBe('ready');
    expect(result.odooMode).toBe('mock');
    expect(result.sources.catalog).toBe('mock');
  });

  it('reports degraded when live catalog is mock-sourced', async () => {
    odoo.isConfigured.mockReturnValue(true);
    catalog.getSnapshot.mockResolvedValue({
      source: 'mock',
      productsBySlug: {},
    });
    content.listPages.mockResolvedValue([{ slug: 'home', name: 'Home', published: true }]);
    shipping.getStorefrontOptions.mockResolvedValue([{ id: 'pallet-standard' }]);
    const result = await probe.probe();
    expect(result.status).toBe('degraded');
    expect(result.issues.some((i) => i.includes('ODOO_MODE=live'))).toBe(true);
  });
});
