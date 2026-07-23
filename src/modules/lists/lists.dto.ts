import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

export class CreateSavedListDto {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @IsOptional()
  @IsEnum(['wishlist', 'reorder', 'project'])
  listType?: 'wishlist' | 'reorder' | 'project';

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}

export class UpdateSavedListDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}

export class ListLineInputDto {
  @IsString()
  productSlug!: string;

  @IsString()
  packagingOptionId!: string;

  @IsNumber()
  @Min(1)
  quantity!: number;

  @IsEnum(['unit', 'partial', 'full'])
  palletType!: 'unit' | 'partial' | 'full';

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;

  @IsOptional()
  @IsBoolean()
  replaceQuantity?: boolean;
}

export class BulkAddSavedListItemsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ListLineInputDto)
  items!: ListLineInputDto[];
}

export class UpdateSavedListItemDto {
  @IsOptional()
  @IsString()
  packagingOptionId?: string;

  @IsOptional()
  @IsNumber()
  @Min(1)
  quantity?: number;

  @IsOptional()
  @IsEnum(['unit', 'partial', 'full'])
  palletType?: 'unit' | 'partial' | 'full';

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;

  @IsOptional()
  @IsNumber()
  sortOrder?: number;
}

export class AddListToCartDto {
  @IsOptional()
  @IsUUID()
  cartId?: string;

  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  itemIds?: string[];

  @IsOptional()
  @IsEnum(['merge', 'replace_matching_lines'])
  mergeMode?: 'merge' | 'replace_matching_lines';

  @IsOptional()
  @IsBoolean()
  skipUnavailable?: boolean;

  @IsOptional()
  @IsBoolean()
  recalculatePrices?: boolean;
}
