/**
 * Account HTTP API for the authenticated storefront: profile, addresses,
 * contacts, orders/payments, B2B credit, and document uploads.
 * Credit application allows optional JWT for guest B2B signup.
 */
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { OptionalJwtGuard } from '../auth/optional-jwt.guard';
import {
  AddressInputDto,
  ContactInputDto,
  CreditApplicationDto,
  NotificationPrefsDto,
  UpdateProfileDto,
  WithdrawCreditsDto,
} from './account.dto';
import { AccountService } from './account.service';

@Controller('account')
export class AccountController {
  constructor(private readonly account: AccountService) {}

  private authUid(req: Request): string {
    return req.user!.sub;
  }

  private optUid(req: Request): string | undefined {
    return req.user?.sub;
  }

  @Get('summary')
  @UseGuards(JwtAuthGuard)
  summary(@Req() req: Request) {
    return this.account.summary(this.authUid(req));
  }

  @Get('profile')
  @UseGuards(JwtAuthGuard)
  profile(@Req() req: Request) {
    return this.account.getProfile(this.authUid(req));
  }

  @Patch('profile')
  @UseGuards(JwtAuthGuard)
  patchProfile(@Req() req: Request, @Body() dto: UpdateProfileDto) {
    return this.account.patchProfile(this.authUid(req), dto);
  }

  @Get('credits')
  @UseGuards(JwtAuthGuard)
  credits(
    @Req() req: Request,
    @Query('tab') tab?: string,
    @Query('status') status?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.account.credits(
      this.authUid(req),
      tab ?? 'credits',
      status ?? 'all',
      Number(page ?? 1) || 1,
      Number(pageSize ?? 20) || 20,
    );
  }

  @Post('credits/withdraw')
  @HttpCode(HttpStatus.ACCEPTED)
  @UseGuards(JwtAuthGuard)
  withdraw(@Req() req: Request, @Body() dto: WithdrawCreditsDto) {
    return this.account.withdraw(this.authUid(req), dto);
  }

  @Get('addresses')
  @UseGuards(JwtAuthGuard)
  addresses(
    @Req() req: Request,
    @Query('usage') usage?: string,
    @Query('defaultsOnly') defaultsOnly?: string,
  ) {
    return this.account.listAddresses(
      this.authUid(req),
      usage ?? 'all',
      defaultsOnly === 'true',
    );
  }

  @Post('addresses')
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(JwtAuthGuard)
  createAddr(@Req() req: Request, @Body() dto: AddressInputDto) {
    return this.account.createAddress(this.authUid(req), dto);
  }

  @Patch('addresses/:addressId')
  @UseGuards(JwtAuthGuard)
  patchAddr(
    @Req() req: Request,
    @Param('addressId') addressId: string,
    @Body() dto: AddressInputDto,
  ) {
    return this.account.patchAddress(this.authUid(req), addressId, dto);
  }

  @Delete('addresses/:addressId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(JwtAuthGuard)
  delAddr(
    @Req() req: Request,
    @Param('addressId') addressId: string,
  ): void {
    this.account.deleteAddress(this.authUid(req), addressId);
  }

  @Post('addresses/:addressId/set-default')
  @UseGuards(JwtAuthGuard)
  defAddr(
    @Req() req: Request,
    @Param('addressId') addressId: string,
    @Query('type') type: string,
  ) {
    return this.account.setDefaultAddress(this.authUid(req), addressId, type);
  }

  @Get('contacts')
  @UseGuards(JwtAuthGuard)
  contacts(
    @Req() req: Request,
    @Query('usage') usage?: string,
    @Query('defaultsOnly') defaultsOnly?: string,
  ) {
    return this.account.listContacts(
      this.authUid(req),
      usage ?? 'all',
      defaultsOnly === 'true',
    );
  }

  @Post('contacts')
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(JwtAuthGuard)
  createCt(@Req() req: Request, @Body() dto: ContactInputDto) {
    return this.account.createContact(this.authUid(req), dto);
  }

  @Get('contacts/:contactId')
  @UseGuards(JwtAuthGuard)
  oneCt(@Req() req: Request, @Param('contactId') contactId: string) {
    return this.account.getContact(this.authUid(req), contactId);
  }

  @Patch('contacts/:contactId')
  @UseGuards(JwtAuthGuard)
  patchCt(
    @Req() req: Request,
    @Param('contactId') contactId: string,
    @Body() dto: ContactInputDto,
  ) {
    return this.account.patchContact(this.authUid(req), contactId, dto);
  }

  @Delete('contacts/:contactId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(JwtAuthGuard)
  delCt(@Req() req: Request, @Param('contactId') contactId: string): void {
    this.account.deleteContact(this.authUid(req), contactId);
  }

  @Post('contacts/:contactId/set-default')
  @UseGuards(JwtAuthGuard)
  defCt(
    @Req() req: Request,
    @Param('contactId') contactId: string,
    @Query('type') type: string,
  ) {
    return this.account.setDefaultContact(this.authUid(req), contactId, type);
  }

  @Get('payment-methods')
  @UseGuards(JwtAuthGuard)
  pm(@Req() req: Request) {
    return this.account.paymentMethods(this.authUid(req));
  }

  @Get('payments')
  @UseGuards(JwtAuthGuard)
  async payments(
    @Req() req: Request,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.account.payments(
      this.authUid(req),
      Number(page ?? 1) || 1,
      Number(pageSize ?? 50) || 50,
    );
  }

  @Get('notifications')
  @UseGuards(JwtAuthGuard)
  notifGet(@Req() req: Request) {
    return this.account.getNotifications(this.authUid(req));
  }

  @Patch('notifications')
  @UseGuards(JwtAuthGuard)
  notifPatch(@Req() req: Request, @Body() dto: NotificationPrefsDto) {
    return this.account.patchNotifications(this.authUid(req), dto);
  }

  @Get('security')
  @UseGuards(JwtAuthGuard)
  sec(@Req() req: Request) {
    return this.account.security(this.authUid(req));
  }

  @Get('orders')
  @UseGuards(JwtAuthGuard)
  async orders(
    @Req() req: Request,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.account.orders(
      this.authUid(req),
      Number(page ?? 1) || 1,
      Number(pageSize ?? 20) || 20,
    );
  }

  @Post('orders/:orderId/wire-receipt')
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024 } }),
  )
  wireReceipt(
    @Req() req: Request,
    @Param('orderId') orderId: string,
    @UploadedFile()
    file:
      | {
          originalname?: string;
          mimetype?: string;
          size?: number;
          buffer?: Buffer;
        }
      | undefined,
    @Body('amount') amount?: string,
    @Body('transferDate') transferDate?: string,
    @Body('orderNumber') orderNumber?: string,
  ) {
    return this.account.uploadWireReceipt(this.authUid(req), {
      orderId,
      orderNumber,
      amount,
      transferDate,
      file,
    });
  }

  @Get('returns')
  @UseGuards(JwtAuthGuard)
  returns(@Req() req: Request, @Query('page') page?: string) {
    return this.account.returns(this.authUid(req), Number(page ?? 1) || 1);
  }

  @Get('business')
  @UseGuards(JwtAuthGuard)
  biz(@Req() req: Request) {
    return this.account.business(this.authUid(req));
  }

  @Get('business/status')
  @UseGuards(JwtAuthGuard)
  bizStatus(@Req() req: Request) {
    return this.account.businessStatus(this.authUid(req));
  }

  @Post('business/credit-application')
  @HttpCode(HttpStatus.ACCEPTED)
  @UseGuards(OptionalJwtGuard)
  creditApp(@Req() req: Request, @Body() dto: CreditApplicationDto) {
    return this.account.submitCredit(this.optUid(req), dto);
  }

  @Post('business/credit-application/:applicationId/documents')
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(FileInterceptor('file'))
  creditDoc(
    @Req() req: Request,
    @Param('applicationId') applicationId: string,
    @UploadedFile() file: { originalname?: string } | undefined,
    @Body('documentType') documentType: string,
  ) {
    return this.account.uploadCreditDoc(
      this.authUid(req),
      applicationId,
      documentType ?? 'other',
      file?.originalname ?? 'upload.bin',
    );
  }

  @Post('business/documents')
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024 } }),
  )
  businessDoc(
    @Req() req: Request,
    @UploadedFile()
    file:
      | {
          originalname?: string;
          mimetype?: string;
          size?: number;
          buffer?: Buffer;
        }
      | undefined,
    @Body('documentType') documentType: string,
  ) {
    return this.account.uploadBusinessDocument(
      this.authUid(req),
      documentType ?? '',
      file,
    );
  }
}
