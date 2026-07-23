import { NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { ContentCacheService } from '../../infrastructure/cache/content-cache.service';
import { OdooClient } from '../../infrastructure/odoo/odoo.client';
import { ContentService } from './content.service';

describe('ContentService', () => {
  const odoo = { isConfigured: jest.fn(), executeKw: jest.fn(), getWebsitePageBlocks: jest.fn() };
  const cache = {
    getPage: jest.fn(),
    setPage: jest.fn(),
    getPageList: jest.fn(),
    setPageList: jest.fn(),
    invalidatePage: jest.fn(),
    invalidateAll: jest.fn(),
  };
  let service: ContentService;

  beforeEach(() => {
    jest.clearAllMocks();
    cache.getPage.mockResolvedValue(null);
    cache.getPageList.mockResolvedValue(null);
    service = new ContentService(
      odoo as unknown as OdooClient,
      cache as unknown as ContentCacheService,
    );
  });

  it('returns fixtures when not live', async () => {
    odoo.isConfigured.mockReturnValue(false);
    const pages = await service.listPages();
    expect(pages.some((p) => p.slug === 'home')).toBe(true);
  });

  it('uses cached page list without calling Odoo', async () => {
    odoo.isConfigured.mockReturnValue(true);
    cache.getPageList.mockResolvedValue([{ slug: 'home', name: 'Home', published: true }]);
    const pages = await service.listPages();
    expect(pages).toHaveLength(1);
    expect(odoo.executeKw).not.toHaveBeenCalled();
  });

  it('throws when live Odoo list fails', async () => {
    odoo.isConfigured.mockReturnValue(true);
    odoo.executeKw.mockRejectedValue(new Error('timeout'));
    await expect(service.listPages()).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('throws not found when live page missing in Odoo', async () => {
    odoo.isConfigured.mockReturnValue(true);
    odoo.executeKw.mockResolvedValue([]);
    await expect(service.getPage('missing')).rejects.toBeInstanceOf(NotFoundException);
  });
});
