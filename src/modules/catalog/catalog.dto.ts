import {
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';

export class PriceQuoteDto {
  @IsString()
  packagingOptionId!: string;

  @IsNumber()
  @Min(1)
  quantity!: number;

  @IsOptional()
  @IsEnum(['full', 'partial', 'unit'])
  palletType?: 'full' | 'partial' | 'unit';
}
