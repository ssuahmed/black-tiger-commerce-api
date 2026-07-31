import { IsString } from 'class-validator';

export class ApplyPromotionDto {
  @IsString()
  code!: string;
}
