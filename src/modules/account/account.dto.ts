import { Type } from 'class-transformer';
import {
  IsEmail,
  IsNumber,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';

export class UpdateProfileDto {
  @IsOptional()
  @IsString()
  firstName?: string;

  @IsOptional()
  @IsString()
  lastName?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  preferredLanguage?: string;

  @IsOptional()
  marketingOptIn?: boolean;
}

export class MoneyDto {
  @IsString()
  currency!: string;

  @IsNumber()
  amount!: number;
}

export class WithdrawCreditsDto {
  @ValidateNested()
  @Type(() => MoneyDto)
  amount!: MoneyDto;

  @IsOptional()
  @IsString()
  bankAccountId?: string;
}

export class AddressInputDto {
  @IsOptional()
  @IsString()
  label?: string;

  @IsString({ each: true })
  usageTypes!: Array<'shipping' | 'billing'>;

  @IsOptional()
  @IsString()
  companyName?: string;

  @IsOptional()
  @IsString()
  recipientName?: string;

  @IsString()
  countryCode!: string;

  @IsString()
  addressLine1!: string;

  @IsOptional()
  @IsString()
  addressLine2?: string;

  @IsString()
  city!: string;

  @IsOptional()
  @IsString()
  stateCode?: string;

  @IsOptional()
  @IsString()
  postalCode?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  deliveryInstructions?: string;

  @IsOptional()
  isDefaultShipping?: boolean;

  @IsOptional()
  isDefaultBilling?: boolean;
}

export class ContactInputDto {
  @IsOptional()
  @IsString()
  label?: string;

  @IsString({ each: true })
  usageTypes!: Array<
    'delivery' | 'order_notifications' | 'billing' | 'accounts_payable'
  >;

  @IsString()
  firstName!: string;

  @IsString()
  lastName!: string;

  @IsEmail()
  email!: string;

  @IsString()
  phone!: string;

  @IsOptional()
  @IsString()
  mobile?: string;

  @IsOptional()
  @IsString()
  jobTitle?: string;

  @IsOptional()
  @IsString()
  department?: string;

  @IsOptional()
  @IsString()
  companyName?: string;

  @IsOptional()
  isDefaultDelivery?: boolean;

  @IsOptional()
  isDefaultOrderNotifications?: boolean;

  @IsOptional()
  isDefaultBilling?: boolean;
}

export class NotificationPrefsDto {
  @IsOptional()
  orderUpdates?: boolean;

  @IsOptional()
  promotions?: boolean;

  @IsOptional()
  creditAlerts?: boolean;

  @IsOptional()
  smsEnabled?: boolean;
}

export class BillingAddressCreditDto {
  @IsString()
  countryCode!: string;

  @IsString()
  companyName!: string;

  @IsString()
  addressLine1!: string;

  @IsString()
  city!: string;

  @IsString()
  stateCode!: string;

  @IsString()
  postalCode!: string;

  @IsOptional()
  @IsString()
  mailStop?: string;

  @IsOptional()
  @IsString()
  addressLine2?: string;

  @IsOptional()
  @IsString()
  postalCodeExt?: string;
}

export class CompanyInfoDto {
  @IsOptional()
  @IsNumber()
  yearFounded?: number;

  @IsOptional()
  @IsString()
  companyClass?: string;

  @IsOptional()
  @IsString()
  dunsNumber?: string;

  @IsOptional()
  @IsString()
  website?: string;

  @IsOptional()
  isSubsidiary?: boolean;
}

export class AccountPreferencesCreditDto {
  @IsString()
  accountsPayablePhone!: string;

  @IsEmail()
  accountsPayableEmail!: string;

  @IsString()
  currency!: string;

  @IsNumber()
  creditLimitDesired!: number;

  @IsOptional()
  @IsString()
  preferredLanguage?: string;
}

export class InvoiceDeliveryDto {
  @IsEmail()
  email!: string;

  @IsOptional()
  @IsString()
  instructions?: string;
}

export class SubmitterDto {
  @IsString()
  name!: string;

  @IsString()
  title!: string;

  @IsString()
  phone!: string;

  @IsEmail()
  email!: string;
}

export class CreditApplicationDto {
  @ValidateNested()
  @Type(() => BillingAddressCreditDto)
  billing!: BillingAddressCreditDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => CompanyInfoDto)
  company?: CompanyInfoDto;

  @ValidateNested()
  @Type(() => AccountPreferencesCreditDto)
  preferences!: AccountPreferencesCreditDto;

  @ValidateNested()
  @Type(() => InvoiceDeliveryDto)
  invoiceDelivery!: InvoiceDeliveryDto;

  @ValidateNested()
  @Type(() => SubmitterDto)
  submitter!: SubmitterDto;
}
