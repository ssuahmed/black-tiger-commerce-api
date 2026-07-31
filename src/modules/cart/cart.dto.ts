import { IsIn, IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class CreateCartDto {
  @IsOptional()
  @IsString()
  mergeCartId?: string;
}

export class AddCartItemDto {
  @IsString()
  productSlug!: string;

  @IsString()
  packagingOptionId!: string;

  @IsNumber()
  @Min(1)
  quantity!: number;

  @IsIn(['unit', 'partial', 'full'])
  palletType!: 'unit' | 'partial' | 'full';
}

export class PatchCartItemDto {
  @IsOptional()
  @IsString()
  packagingOptionId?: string;

  @IsOptional()
  @IsNumber()
  @Min(1)
  quantity?: number;

  @IsOptional()
  @IsIn(['unit', 'partial', 'full'])
  palletType?: 'unit' | 'partial' | 'full';
}
