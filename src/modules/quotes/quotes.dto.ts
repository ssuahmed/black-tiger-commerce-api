import { IsOptional, IsString } from 'class-validator';

export class QuoteCreateDto {
  @IsString()
  cartId!: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsString()
  purchaseOrderNumber?: string;
}
