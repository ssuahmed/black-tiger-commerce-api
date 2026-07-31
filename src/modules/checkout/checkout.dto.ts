import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsEmail,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  ValidateNested,
} from 'class-validator';

export class CheckoutInlineAddressDto {
  @IsOptional()
  @IsString()
  label?: string;

  @IsArray()
  @IsEnum(['shipping', 'billing'], { each: true })
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
  @IsString()
  buildingNo?: string;

  @IsOptional()
  @IsString()
  street?: string;

  @IsOptional()
  @IsString()
  secondary?: string;

  @IsOptional()
  @IsString()
  district?: string;

  @IsOptional()
  @IsString()
  landmark?: string;

  @IsOptional()
  @IsNumber()
  latitude?: number;

  @IsOptional()
  @IsNumber()
  longitude?: number;

  @IsOptional()
  @IsString()
  placeId?: string;

  @IsOptional()
  @IsString()
  formattedAddress?: string;

  @IsOptional()
  @IsEnum(['home', 'work', 'business', 'pickup'])
  addressKind?: 'home' | 'work' | 'business' | 'pickup';

  @IsOptional()
  @IsString()
  warehouseSlug?: string;

  @IsOptional()
  @IsString()
  portOfDestination?: string;

  @IsOptional()
  @IsString()
  freightType?: string;

  @IsOptional()
  @IsString()
  nationalAddress?: string;

  @IsOptional()
  @IsString()
  companyFloor?: string;

  @IsOptional()
  @IsBoolean()
  isDefaultShipping?: boolean;

  @IsOptional()
  @IsBoolean()
  isDefaultBilling?: boolean;
}

export class CheckoutInlineContactDto {
  @IsOptional()
  @IsString()
  label?: string;

  @IsArray()
  @IsEnum(['delivery', 'order_notifications', 'billing', 'accounts_payable'], {
    each: true,
  })
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
  @IsBoolean()
  isDefaultDelivery?: boolean;

  @IsOptional()
  @IsBoolean()
  isDefaultOrderNotifications?: boolean;

  @IsOptional()
  @IsBoolean()
  isDefaultBilling?: boolean;
}

export class CheckoutAddressDto {
  @IsOptional()
  @IsString()
  purchaseOrderNumber?: string;

  @IsOptional()
  @IsString()
  orderNotes?: string;

  @IsOptional()
  @IsUUID()
  shippingAddressId?: string;

  @IsOptional()
  @IsUUID()
  billingAddressId?: string;

  @IsOptional()
  @IsBoolean()
  billingSameAsShipping?: boolean;

  @IsOptional()
  @IsUUID()
  deliveryContactId?: string;

  @IsOptional()
  @IsUUID()
  billingContactId?: string;

  @IsOptional()
  @IsUUID()
  orderNotificationContactId?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => CheckoutInlineAddressDto)
  shippingAddress?: CheckoutInlineAddressDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => CheckoutInlineAddressDto)
  billingAddress?: CheckoutInlineAddressDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => CheckoutInlineContactDto)
  deliveryContact?: CheckoutInlineContactDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => CheckoutInlineContactDto)
  billingContact?: CheckoutInlineContactDto;

  @IsOptional()
  @IsBoolean()
  saveToAddressBook?: boolean;

  @IsOptional()
  @IsBoolean()
  saveContacts?: boolean;
}

export class CheckoutShippingDto {
  @IsString()
  shippingOptionId!: string;

  @IsOptional()
  @IsString()
  purchaseOrderNumber?: string;

  @IsOptional()
  @IsString()
  orderNotes?: string;
}

export class CheckoutSubmitDto {
  @IsOptional()
  @IsBoolean()
  confirm?: boolean;

  @IsOptional()
  @IsEnum(['card', 'cod', 'wire'])
  paymentMethod?: 'card' | 'cod' | 'wire';

  @IsOptional()
  @IsString()
  purchaseOrderNumber?: string;

  @IsOptional()
  @IsString()
  orderNotes?: string;
}

export class CheckoutPaymentIntentDto {
  @IsEnum(['card', 'cod', 'wire'])
  method!: 'card' | 'cod' | 'wire';
}

export class CheckoutConfirmPaymentDto {
  @IsString()
  paymentIntentId!: string;
}

export class ResolveCheckoutAddressDto {
  @IsOptional()
  @IsString()
  query?: string;

  @IsOptional()
  @IsString()
  placeId?: string;

  @IsOptional()
  @IsNumber()
  lat?: number;

  @IsOptional()
  @IsNumber()
  lng?: number;
}
