import { IsEmail, IsIn, IsOptional, IsString, MinLength } from 'class-validator';

export class CreateContactInquiryDto {
  @IsIn(['mr', 'mrs'])
  title!: 'mr' | 'mrs';

  @IsString()
  @MinLength(1)
  name!: string;

  @IsString()
  @MinLength(1)
  company!: string;

  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(3)
  phone!: string;

  @IsString()
  @MinLength(1)
  address!: string;

  @IsString()
  @MinLength(1)
  city!: string;

  @IsString()
  @MinLength(2)
  country!: string;

  @IsString()
  @MinLength(1)
  message!: string;

  @IsOptional()
  @IsString()
  source?: string;
}
