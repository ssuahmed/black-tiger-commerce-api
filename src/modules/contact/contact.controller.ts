import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { CreateContactInquiryDto } from './contact.dto';
import { ContactService } from './contact.service';

@Controller('contact')
export class ContactController {
  constructor(private readonly contact: ContactService) {}

  @Post('inquiries')
  @HttpCode(HttpStatus.CREATED)
  create(@Body() dto: CreateContactInquiryDto) {
    return this.contact.create(dto);
  }
}
