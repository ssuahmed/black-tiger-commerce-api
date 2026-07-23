import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/** Marks route/controller as skipping JWT authentication (used with Swagger). */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
