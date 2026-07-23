import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { newId } from '../../common/utils/uuid';
import type { ProductFixture } from '../../mocks/catalog.fixtures';
import { CatalogProductsProvider } from '../catalog/catalog-products.provider';
import type {
  SavedListEntity,
  SavedListItemEntity,
} from '../../persistence/persistence.service';
import { PersistenceService } from '../../persistence/persistence.service';
import { CartService } from '../cart/cart.service';
import type {
  AddListToCartDto,
  BulkAddSavedListItemsDto,
  CreateSavedListDto,
  ListLineInputDto,
  UpdateSavedListDto,
  UpdateSavedListItemDto,
} from './lists.dto';

function paginate<T>(items: T[], page: number, pageSize: number) {
  const total = items.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const slice = items.slice((page - 1) * pageSize, page * pageSize);
  return {
    items: slice,
    pagination: { page, pageSize, total, totalPages },
  };
}

@Injectable()
export class ListsService {
  constructor(
    private readonly persistence: PersistenceService,
    private readonly cartService: CartService,
    private readonly catalog: CatalogProductsProvider,
  ) {}

  private bucket(userId: string) {
    return this.persistence.getUserLists(userId);
  }

  private assertList(userId: string, listId: string): SavedListEntity {
    const list = this.bucket(userId).get(listId);
    if (!list) {
      throw new NotFoundException('List not found');
    }
    return list;
  }

  private previewImages(
    list: SavedListEntity,
    productsBySlug: Record<string, ProductFixture>,
  ): string[] {
    return list.items.slice(0, 4).map((i) => {
      const p = productsBySlug[i.productSlug];
      return p?.imageUrl ?? '';
    });
  }

  private summary(
    list: SavedListEntity,
    productsBySlug: Record<string, ProductFixture>,
  ) {
    return {
      id: list.id,
      name: list.name,
      description: list.description ?? null,
      listType: list.listType,
      itemCount: list.items.length,
      previewImages: this.previewImages(list, productsBySlug),
      isDefault: list.isDefault,
      createdAt: list.createdAt,
      updatedAt: list.updatedAt,
    };
  }

  private enrichItem(
    it: SavedListItemEntity,
    productsBySlug: Record<string, ProductFixture>,
  ) {
    const p = productsBySlug[it.productSlug];
    return {
      ...it,
      productSnapshot: p
        ? {
            name: p.name,
            productCode: p.productCode,
            imageUrl: p.imageUrl,
            categoryLabel: p.categoryLabel,
          }
        : undefined,
      availability: {
        inStock: p?.inStock ?? false,
        purchasable: !!p?.inStock,
        message: p?.inStock ? null : 'Unavailable',
      },
    };
  }

  async list(userId: string, page = 1, pageSize = 20, sort = 'updatedAt_desc') {
    const { productsBySlug } = await this.catalog.getSnapshot();
    const lists = [...this.bucket(userId).values()];
    lists.sort((a, b) => {
      switch (sort) {
        case 'name_asc':
          return a.name.localeCompare(b.name);
        case 'name_desc':
          return b.name.localeCompare(a.name);
        case 'createdAt_desc':
          return b.createdAt.localeCompare(a.createdAt);
        default:
          return b.updatedAt.localeCompare(a.updatedAt);
      }
    });
    const row = paginate(
      lists.map((l) => this.summary(l, productsBySlug)),
      page,
      pageSize,
    );
    return row;
  }

  async create(userId: string, dto: CreateSavedListDto) {
    for (const l of this.bucket(userId).values()) {
      if (l.name.trim().toLowerCase() === dto.name.trim().toLowerCase()) {
        throw new ConflictException('Duplicate list name');
      }
    }
    const now = new Date().toISOString();
    const row: SavedListEntity = {
      id: newId(),
      userId,
      name: dto.name.trim(),
      description: dto.description ?? null,
      listType: dto.listType ?? 'wishlist',
      isDefault: dto.isDefault ?? false,
      createdAt: now,
      updatedAt: now,
      items: [],
    };
    this.bucket(userId).set(row.id, row);
    const { productsBySlug } = await this.catalog.getSnapshot();
    return this.summary(row, productsBySlug);
  }

  async detail(userId: string, listId: string, includeItems = true) {
    const { productsBySlug } = await this.catalog.getSnapshot();
    const list = this.assertList(userId, listId);
    const items = includeItems
      ? list.items.map((i) => this.enrichItem(i, productsBySlug))
      : [];
    let est = 0;
    for (const it of list.items) {
      const p = productsBySlug[it.productSlug];
      if (p) {
        est += p.unitPrice * it.quantity;
      }
    }
    return {
      ...this.summary(list, productsBySlug),
      items,
      estimatedSubtotal: {
        currency: 'SAR',
        amount: est,
        formatted: `${est.toLocaleString('en-SA')} SAR`,
      },
    };
  }

  async patch(userId: string, listId: string, dto: UpdateSavedListDto) {
    const list = this.assertList(userId, listId);
    if (dto.name !== undefined) {
      for (const l of this.bucket(userId).values()) {
        if (
          l.id !== listId &&
          l.name.trim().toLowerCase() === dto.name.trim().toLowerCase()
        ) {
          throw new ConflictException('Duplicate list name');
        }
      }
      list.name = dto.name.trim();
    }
    if (dto.description !== undefined) {
      list.description = dto.description;
    }
    if (dto.isDefault !== undefined) {
      list.isDefault = dto.isDefault;
    }
    list.updatedAt = new Date().toISOString();
    const { productsBySlug } = await this.catalog.getSnapshot();
    return this.summary(list, productsBySlug);
  }

  delete(userId: string, listId: string) {
    this.assertList(userId, listId);
    this.bucket(userId).delete(listId);
  }

  async itemsPage(userId: string, listId: string, page = 1, pageSize = 50) {
    const { productsBySlug } = await this.catalog.getSnapshot();
    const list = this.assertList(userId, listId);
    const enriched = list.items.map((i) => this.enrichItem(i, productsBySlug));
    return {
      listId,
      ...paginate(enriched, page, pageSize),
    };
  }

  async addItem(userId: string, listId: string, dto: ListLineInputDto) {
    const { productsBySlug } = await this.catalog.getSnapshot();
    const list = this.assertList(userId, listId);
    const product = productsBySlug[dto.productSlug];
    if (!product) {
      throw new NotFoundException('Product not found');
    }
    const pkg = product.packagingOptions.find(
      (p) => p.id === dto.packagingOptionId,
    );
    if (!pkg) {
      throw new NotFoundException('Packaging option not found');
    }
    const existing = list.items.find(
      (l) =>
        l.productSlug === dto.productSlug &&
        l.packagingOptionId === dto.packagingOptionId &&
        l.palletType === dto.palletType,
    );
    let row: SavedListItemEntity;
    if (existing) {
      existing.quantity = dto.replaceQuantity
        ? dto.quantity
        : existing.quantity + dto.quantity;
      existing.notes = dto.notes ?? existing.notes;
      row = existing;
    } else {
      row = {
        id: newId(),
        productSlug: dto.productSlug,
        packagingOptionId: dto.packagingOptionId,
        quantity: dto.quantity,
        palletType: dto.palletType,
        notes: dto.notes ?? null,
        sortOrder: list.items.length,
        addedAt: new Date().toISOString(),
      };
      list.items.push(row);
    }
    list.updatedAt = new Date().toISOString();
    return this.enrichItem(row, productsBySlug);
  }

  async bulk(userId: string, listId: string, dto: BulkAddSavedListItemsDto) {
    const results: Array<{
      index: number;
      success: boolean;
      item?: Record<string, unknown>;
      error?: { code: string; message: string };
    }> = [];
    for (let index = 0; index < dto.items.length; index++) {
      const line = dto.items[index];
      try {
        const created = await this.addItem(userId, listId, line);
        results.push({ index, success: true, item: created });
      } catch (e: unknown) {
        results.push({
          index,
          success: false,
          error: {
            code: 'LINE_REJECTED',
            message: e instanceof Error ? e.message : 'Failed',
          },
        });
      }
    }
    return { results };
  }

  async patchItem(
    userId: string,
    listId: string,
    itemId: string,
    dto: UpdateSavedListItemDto,
  ) {
    const list = this.assertList(userId, listId);
    const item = list.items.find((i) => i.id === itemId);
    if (!item) {
      throw new NotFoundException('Item not found');
    }
    if (dto.quantity !== undefined) {
      item.quantity = dto.quantity;
    }
    if (dto.packagingOptionId !== undefined) {
      item.packagingOptionId = dto.packagingOptionId;
    }
    if (dto.palletType !== undefined) {
      item.palletType = dto.palletType;
    }
    if (dto.notes !== undefined) {
      item.notes = dto.notes;
    }
    if (dto.sortOrder !== undefined) {
      item.sortOrder = dto.sortOrder;
    }
    list.updatedAt = new Date().toISOString();
    const { productsBySlug } = await this.catalog.getSnapshot();
    return this.enrichItem(item, productsBySlug);
  }

  removeItem(userId: string, listId: string, itemId: string) {
    const list = this.assertList(userId, listId);
    const idx = list.items.findIndex((i) => i.id === itemId);
    if (idx < 0) {
      throw new NotFoundException('Item not found');
    }
    list.items.splice(idx, 1);
    list.updatedAt = new Date().toISOString();
  }

  clearItems(userId: string, listId: string) {
    const list = this.assertList(userId, listId);
    list.items = [];
    list.updatedAt = new Date().toISOString();
  }

  async addListToCart(userId: string, listId: string, dto: AddListToCartDto) {
    const { productsBySlug } = await this.catalog.getSnapshot();
    const list = this.assertList(userId, listId);
    let cartId = dto.cartId;
    if (!cartId) {
      const created = await this.cartService.createCart(userId);
      cartId = created.id as string;
    } else {
      await this.cartService.getCart(cartId, userId);
    }
    const subset =
      dto.itemIds && dto.itemIds.length > 0
        ? list.items.filter((i) => dto.itemIds!.includes(i.id))
        : list.items;
    let addedCount = 0;
    const skipped: Array<{
      itemId: string;
      productSlug: string;
      reason: string;
    }> = [];
    for (const line of subset) {
      const p = productsBySlug[line.productSlug];
      if (!p?.inStock && dto.skipUnavailable !== false) {
        skipped.push({
          itemId: line.id,
          productSlug: line.productSlug,
          reason: 'out_of_stock',
        });
        continue;
      }
      if (dto.mergeMode === 'replace_matching_lines') {
        try {
          const cart = this.cartService.requireCart(cartId);
          const existing = cart.items.find(
            (c) =>
              c.productSlug === line.productSlug &&
              c.packagingOptionId === line.packagingOptionId &&
              c.palletType === line.palletType,
          );
          if (existing) {
            await this.cartService.patchItem(
              cartId,
              existing.id,
              { quantity: line.quantity },
              userId,
            );
          } else {
            await this.cartService.addItem(
              cartId,
              {
                productSlug: line.productSlug,
                packagingOptionId: line.packagingOptionId,
                quantity: line.quantity,
                palletType: line.palletType,
              },
              userId,
            );
          }
          addedCount++;
        } catch {
          skipped.push({
            itemId: line.id,
            productSlug: line.productSlug,
            reason: 'pricing_unavailable',
          });
        }
      } else {
        try {
          await this.cartService.addItem(
            cartId,
            {
              productSlug: line.productSlug,
              packagingOptionId: line.packagingOptionId,
              quantity: line.quantity,
              palletType: line.palletType,
            },
            userId,
          );
          addedCount++;
        } catch {
          skipped.push({
            itemId: line.id,
            productSlug: line.productSlug,
            reason: 'pricing_unavailable',
          });
        }
      }
    }
    const cartView = await this.cartService.getCart(cartId, userId);
    if (addedCount === 0 && subset.length > 0) {
      throw new UnprocessableEntityException('No valid lines could be added');
    }
    return {
      cartId,
      addedCount,
      skipped,
      cartItemCount: cartView.items?.length ?? 0,
      cartHref: '/cart',
      checkoutReady: false,
    };
  }
}
