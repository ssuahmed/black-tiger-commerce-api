import { IsOptional, IsString } from 'class-validator';

export class QuoteCreateDto {
  @IsOptional()
  @IsString()
  notes?: string;
}
