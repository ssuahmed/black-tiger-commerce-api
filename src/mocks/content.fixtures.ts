/** Mirrors Odoo `black_tiger_website` seed data — used when ODOO_MODE≠live */

export type ContentBlock = {
  key: string;
  type: string;
  text?: string | null;
  html?: string | null;
  imageUrl?: string | null;
  json?: unknown;
  link?: { label: string | null; href: string | null } | null;
};

export type ContentPageFixture = {
  slug: string;
  name: string;
  published: boolean;
  blocks: Record<string, ContentBlock>;
};

function block(
  key: string,
  type: string,
  partial: Partial<Omit<ContentBlock, 'key' | 'type'>> = {},
): ContentBlock {
  return { key, type, text: null, html: null, imageUrl: null, json: null, link: null, ...partial };
}

const HOME_PRODUCT_STRIP_JSON = [
  {
    id: 'tiger-x',
    title: 'Tiger X',
    href: '/products/tiger-x-5w30-sn',
    variant: 'product',
    smoke: '/images/home/section-2/smoke-red.png',
    productImage: '/images/home/section-2/tiger-x.png',
    productAlt: 'TIGER X 15W40 CI-4/SL motor oil',
  },
  {
    id: 'tiger-plus',
    title: 'Tiger Plus',
    href: '/products/tiger-x-5w30-sn',
    variant: 'product',
    smoke: '/images/home/section-2/smoke-blue.png',
    productImage: '/images/home/section-2/tiger-plus.png',
    productAlt: 'TIGER Plus 15W40 CI-4 motor oil',
  },
  {
    id: 'tiger',
    title: 'Tiger',
    href: '/products/tiger-20w50-sl',
    variant: 'product',
    smoke: '/images/home/section-2/smoke-red.png',
    productImage: '/images/home/section-2/tiger.png',
    productAlt: 'TIGER 20W50 CI-4/SL motor oil',
  },
  {
    id: 'quality',
    title: 'Quality Is First',
    href: '/about',
    variant: 'quality',
    background: '/images/home/section-2/quality-bg.png',
    productImage: '/images/home/section-2/quality-packaging.png',
    productAlt: 'Black Tiger product packaging',
    showReadMore: false,
  },
] as const;

const HOME_FOOTER_JSON = {
  navLinks: [
    { label: 'TIGER X', href: '/products/tiger-x-5w30-sn' },
    { label: 'TIGER PLUS', href: '/products/tiger-x-5w30-sn' },
    { label: 'TIGER', href: '/products/tiger-20w50-sl' },
    { label: 'DISCLAIMER', href: '/disclaimer' },
  ],
  contactHeading: 'ANY QUESTION',
  contactCta: { label: 'CONTACT US', href: '/contact' },
  socialHeading: 'STAY TUNED',
  socialLinks: [
    { label: 'Facebook', href: 'https://www.facebook.com/', icon: 'facebook' },
    { label: 'X', href: 'https://x.com/', icon: 'x' },
    { label: 'LinkedIn', href: 'https://www.linkedin.com/', icon: 'linkedin' },
    { label: 'YouTube', href: 'https://www.youtube.com/', icon: 'youtube' },
    { label: 'Vimeo', href: 'https://vimeo.com/', icon: 'vimeo' },
  ],
  logoUrl: '/logo.png',
  logoAlt: 'Black Tiger',
} as const;

const HOME_BLOCKS: Record<string, ContentBlock> = {
  'hero.title': block('hero.title', 'text', { text: 'The High-End Lubricants' }),
  'hero.background_image': block('hero.background_image', 'image', {
    imageUrl: '/images/home/section-1.png',
  }),
  'hero.cta': block('hero.cta', 'cta', { link: { label: 'Ask AI', href: '#' } }),
  'section3.background_image': block('section3.background_image', 'image', {
    imageUrl: '/images/home/section-3.png',
  }),
  'section3.cta': block('section3.cta', 'cta', { link: { label: 'Shop Now', href: '/shop' } }),
  'section4.background_image': block('section4.background_image', 'image', {
    imageUrl: '/images/home/section-4/background.png',
  }),
  'section4.stronger_image': block('section4.stronger_image', 'image', {
    imageUrl: '/images/home/section-4/stronger.png',
  }),
  'section4.eyebrow': block('section4.eyebrow', 'text', { text: 'TECHNOLOGY' }),
  'section4.title_line1': block('section4.title_line1', 'text', { text: 'ADAPTIVE SHIELD' }),
  'section4.title_line2': block('section4.title_line2', 'text', { text: 'TECH-NOLOGY' }),
  'section4.body': block('section4.body', 'html', {
    html: '<p>Our Adaptive Shield Technology helps break new ground in engine performance. The technology is a combination of additive chemistries that shield engine parts from internal and external factors, by creating a robust shield against the extreme pressures, temperatures and shear forces affecting a broad range of engines.</p>',
  }),
  'section4.cta': block('section4.cta', 'cta', { link: { label: 'LEARN MORE', href: '/about' } }),
  'hot_selling.title': block('hot_selling.title', 'text', { text: 'Hot Selling Products' }),
  'product_strip.data': block('product_strip.data', 'json', { json: HOME_PRODUCT_STRIP_JSON }),
  'applications.data': block('applications.data', 'json', {
    json: [
      {
        id: 'passenger-car',
        title: 'Passenger Car',
        slug: 'passenger-cars',
        applications: [
          { slug: 'petrol-engine', label: 'Petrol Engine', icon: 'petrol' },
          { slug: 'diesel-engine', label: 'Diesel Engine', icon: 'diesel' },
          { slug: 'gear-transmission', label: 'Gear & Transmission', icon: 'gear' },
        ],
      },
      {
        id: 'trucks-heavy',
        title: 'Trucks & Heavy Equipment',
        slug: 'commercial',
        applications: [
          { slug: 'diesel-engine', label: 'Diesel Engine', icon: 'diesel' },
          { slug: 'transmission', label: 'Transmission', icon: 'gear' },
        ],
      },
    ],
  }),
  'section6.image': block('section6.image', 'image', { imageUrl: '/images/home/section-6.png' }),
  'section7.image': block('section7.image', 'image', { imageUrl: '/images/home/section-7.png' }),
  'section8.image': block('section8.image', 'image', { imageUrl: '/images/home/section-8.png' }),
  'footer.data': block('footer.data', 'json', { json: HOME_FOOTER_JSON }),
};

export const CONTENT_PAGES: Record<string, ContentPageFixture> = {
  home: { slug: 'home', name: 'Homepage', published: true, blocks: HOME_BLOCKS },
  contact: {
    slug: 'contact',
    name: 'Contact Us',
    published: true,
    blocks: {
      'hero.title': block('hero.title', 'text', { text: 'CONTACT US' }),
      'hero.background_image': block('hero.background_image', 'image', {
        imageUrl: '/images/home/section-1.png',
      }),
      'form.heading': block('form.heading', 'text', { text: 'CONTACT BLACK TIGER' }),
    },
  },
  shop: {
    slug: 'shop',
    name: 'Shop',
    published: true,
    blocks: {
      'hero.eyebrow': block('hero.eyebrow', 'text', { text: 'TECHNOLOGY' }),
      'hero.title': block('hero.title', 'text', { text: 'ADAPTIVE SHIELD TECHNOLOGY' }),
      'hero.body': block('hero.body', 'html', {
        html: '<p>Our Adaptive Shield Technology helps break new ground in engine performance. The technology is a combination of additive chemistries that shield engine parts from internal and external factors, by creating a robust shield against the extreme pressures, temperatures and shear forces affecting a broad range of engines.</p>',
      }),
      'hero.cta': block('hero.cta', 'cta', { link: { label: 'LEARN MORE', href: '/about' } }),
      'hero.background_image': block('hero.background_image', 'image', {
        imageUrl: '/images/shop/bg-image.png',
      }),
    },
  },
  about: {
    slug: 'about',
    name: 'About Us',
    published: true,
    blocks: {
      'page.title': block('page.title', 'text', { text: 'About Black Tiger' }),
      'page.body': block('page.body', 'html', {
        html: '<p>Black Tiger manufactures high-end lubricants engineered for performance and reliability.</p>',
      }),
    },
  },
};
