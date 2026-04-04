# Lens

![GitHub](https://img.shields.io/github/license/bysages/lens)
![GitHub Actions](https://img.shields.io/github/actions/workflow/status/bysages/lens/docker-build.yml)
[![Contributor Covenant](https://img.shields.io/badge/Contributor%20Covenant-2.1-4baaaa.svg)](https://www.contributor-covenant.org/version/2/1/code_of_conduct/)

> A high-performance image proxy and web services toolkit built with modern TypeScript. Lens provides a comprehensive suite of web utilities including image processing, screenshot capture, font serving, and more.

## 🚀 Features

### Core Services

- **🖼️ Image Proxy**: IPX-powered image processing with resize, format conversion, optimization
- **📸 Screenshot Capture**: Fast website screenshot service with resource optimization
- **🅰️ Font Service**: Google Fonts compatible API with multiple providers
- **🎨 Open Graph Images**: Dynamic OG image generation
- **🎯 Favicon Extraction**: Smart favicon extraction from websites
- **👤 Gravatar Proxy**: Cached Gravatar avatar proxy with email or hash input

### Performance & Scalability

- **⚡ Redis Caching**: Redis-powered caching with 24-hour intelligent caching
- **🚀 Resource Optimization**: Optimized page loading with blocked unnecessary resources
- **🛡️ Rate Limiting**: Rate limiting for expensive operations
- **☁️ Cloud Native**: Support for Railway, Zeabur, and other persistent runtime platforms
- **🔄 Graceful Degradation**: Automatic fallbacks for missing services

## 📦 Quick Start

### Prerequisites

- Node.js 22+
- pnpm 10+ (recommended) or npm

### Installation

```bash
# Clone the repository
git clone https://github.com/bysages/lens.git
cd lens

# Install dependencies
pnpm install

# Copy environment configuration
cp .env.example .env
```

### Development

```bash
# Start development server
pnpm dev

# Build for production
pnpm build

# Preview production build
pnpm preview
```

The server will start on `http://localhost:3000` by default.

## 🛠️ Configuration

### Configuration

All configurations are optional and will gracefully degrade:

```env
# Image proxy security
ALLOWED_DOMAINS=example.com,cdn.example.com

# Caching (significantly improves performance)
REDIS_URL=redis://localhost:6379
```

See `.env.example` for all available options.

## 📡 API Reference

All cached responses include `X-Cache` headers (HIT/MISS) and `ETag` headers for conditional 304 responses.

### Image Proxy

Transform and optimize images on-the-fly:

```
GET /img/{modifiers}/{image_url}
```

**Examples:**

```bash
# Resize to 300px width, convert to WebP
/img/w_300,f_webp/https://example.com/image.jpg

# Create 200x200 square thumbnail
/img/s_200x200,q_80/https://example.com/image.png

# Smart crop with high quality
/img/w_400,h_300,c_fill,q_95/https://example.com/photo.jpg
```

**Supported Modifiers:**

- `w_XXX` - Width
- `h_XXX` - Height
- `s_XXXxYYY` - Size (width x height)
- `f_FORMAT` - Format (webp, jpg, png, avif)
- `q_XXX` - Quality (1-100)
- `c_MODE` - Crop mode (fill, fit, pad)

**Performance Features:**

- Redis caching for optimal performance
- Automatic format optimization and compression

### Screenshot Capture

Capture website screenshots:

```
GET /screenshot?url={website_url}&options
```

**Examples:**

```bash
# Basic screenshot
/screenshot?url=https://example.com

# Mobile screenshot with custom size
/screenshot?url=https://example.com&width=375&height=667&mobile=true

# Full page with WebP format
/screenshot?url=https://example.com&fullPage=true&format=webp&quality=90
```

**Parameters:**

- `url` - Website URL (required)
- `width` - Viewport width (default: 1280)
- `height` - Viewport height (default: 720)
- `format` - Output format (png, jpeg, webp)
- `quality` - JPEG quality (1-100)
- `fullPage` - Capture full page (true/false, default: false for viewport capture)
- `mobile` - Mobile viewport (true/false)
- `darkMode` - Dark mode (true/false)
- `deviceScaleFactor` - Device scale factor (default: 1)
- `waitUntil` - Navigation wait condition (load, domcontentloaded, networkidle, default: domcontentloaded)
- `delay` - Additional delay in milliseconds after page load (0-1000)

**Performance Notes:**

- Screenshots are cached for 1 day with rate limiting
- Identical requests return cached results with sub-second response times
- Resource optimization (blocking fonts, media, websockets) speeds up screenshot generation by 60-80%

### Font Service

Google Fonts compatible API with both v1 and v2 endpoints:

```
GET /css?family={font_family}&display=swap
GET /css2?family={font_family}&display=swap
```

**API Differences:**

| Feature        | `/css` (v1)                    | `/css2` (v2)                                  |
| -------------- | ------------------------------ | --------------------------------------------- |
| Multiple fonts | `family=A\|B` (pipe separator) | `family=A&family=B` (repeated parameter)      |
| Style syntax   | `FontName:400,700` (old)       | `FontName:wght@400;700` (new, strict)         |
| Variable fonts | ❌ Not supported               | ✅ Full support with ranges (`wght@200..900`) |
| Base URL       | `fonts.googleapis.com/css`     | `fonts.googleapis.com/css2`                   |

**Parameters:**

- `family` - Font family name (required)
- `display` - Font display strategy (default: swap)
- `subset` - Font subset (default: latin)
- `provider` - Font provider (google, bunny, fontshare, fontsource, default: google)
- `proxy` - Use proxy for font files (true/false, default: false)

**Examples:**

```bash
# Basic font (v1 API - pipe separator)
/css?family=Roboto:wght@400;700|Open+Sans:wght@300;400;600&display=swap

# Multiple fonts (v2 API - repeated family parameter)
/css2?family=Inter:wght@400;700&family=Roboto:wght@300;400&display=swap

# Variable fonts with weight range (v2 only)
/css2?family=Inter:wght@200..800&display=swap

# Font metadata
/webfonts?sort=popularity&category=sans-serif
```

**Recommendations:**

- Use `/css` for **legacy compatibility** with old Google Fonts syntax
- Use `/css2` for **modern applications** with variable fonts and better optimization
- Both endpoints support all font providers (Google, Bunny, Fontshare, Fontsource)

### Open Graph Images

Generate dynamic OG images:

```
GET /og?title={title}&description={description}
```

**Examples:**

```bash
# Basic OG image
/og?title=Welcome&description=Get started with Lens

# Custom styling
/og?title=Hello World&theme=dark&fontSize=72&width=1200&height=630
```

**Caching:**

- Generated OG images are cached for 24 hours
- Identical requests with same parameters return cached results instantly

### Favicon Extraction

Extract high-quality favicons:

```
GET /favicon?url={website_url}&size={size}
```

**Examples:**

```bash
# Extract favicon
/favicon?url=https://example.com

# Custom size
/favicon?url=https://example.com&size=64
```

**Features:**

- Smart favicon extraction from multiple sources (PWA manifests, Apple touch icons, HTML tags)
- 30-day server-side caching with ETag/304 support
- Automatic fallback to generated favicon if none found

### Gravatar Proxy

Get Gravatar avatars by email, MD5 hash, or path. All query parameters (except `email`/`hash`) are forwarded directly to Gravatar. You can switch from Gravatar by simply replacing the URL prefix.

```
GET /gravatar/{md5}?{gravatar_params}
GET /gravatar?email={email}
GET /gravatar?hash={md5}&{gravatar_params}
```

**Examples:**

```bash
# By path (drop-in replacement for Gravatar URLs)
/gravatar/{md5}?size=200

# By email
/gravatar?email=user@example.com

# By MD5 hash
/gravatar?hash={md5}

# With Gravatar parameters
/gravatar?email=user@example.com&size=200&default=identicon&rating=pg
```

**Parameters:**

- `{md5}` - MD5 hash in URL path (drop-in replacement mode)
- `email` - Email address (will be MD5 hashed automatically)
- `hash` - Pre-computed MD5 hash (alternative to email)
- All other parameters are forwarded to [Gravatar API](https://docs.gravatar.com/api/images/)

## 🏗️ Architecture

Lens is built with modern web standards and follows clean architecture principles:

### Core Technologies

- **Runtime**: Node.js 22+ with Nitro
- **Language**: TypeScript with strict type safety
- **Image Proxy**: IPX with Sharp
- **Browser Automation**: Playwright with singleton browser and isolated contexts
- **Caching**: Redis with unstorage

### Design Principles

- **KISS (Keep It Simple)**: Simple, focused solutions over complex abstractions
- **DRY (Don't Repeat Yourself)**: Shared utilities and configurations
- **Graceful Degradation**: Fallbacks for missing dependencies
- **Type Safety**: Comprehensive TypeScript coverage
- **Performance First**: Optimized for speed and efficiency

## 🚀 Deployment

### Prerequisites

- **Node.js** 22+ runtime
- **pnpm** 10+ package manager
- **Redis** (optional, for distributed caching)

### Production Deployment

```bash
# Build the application
pnpm run build

# Start production server
pnpm run preview
```

### Docker Deployment (Recommended)

#### Option 1: Using Docker Compose

```bash
# Copy environment variables
cp .env.example .env

# Edit .env file to configure your settings
# nano .env

# Start the application
docker-compose up -d

# View logs
docker-compose logs -f app

# Stop the application
docker-compose down
```

The application will be available at `http://localhost:3000`

The stack includes:

- **Lens** application on port 3000
- **Redis** for distributed caching (optional but recommended)

#### Option 2: Using Docker Run

```bash
# Pull the official image
docker pull bysages/lens:latest

# Run container with host network (recommended for accurate IP logging)
docker run -d \
  --name lens \
  --network host \
  --env-file .env \
  --restart unless-stopped \
  bysages/lens:latest

# View logs
docker logs -f lens

# Stop the container
docker stop lens
docker rm lens
```

#### Option 3: Build from Source

```bash
# Build Docker image
docker build -t lens .

# Run container
docker run -d \
  --name lens \
  --network host \
  --env-file .env \
  --restart unless-stopped \
  lens
```

### Platform Compatibility

**⚠️ Important**: This application requires a **persistent runtime environment** for optimal performance.

**✅ Fully Supported:**

- **Vercel** - Native support with automatic optimization
- **Cloudflare Containers** - Docker container deployment with persistent runtime
- Traditional VPS/Dedicated servers
- Docker containers
- Render.com
- DigitalOcean App Platform
- Heroku
- Any platform with persistent Node.js 22+ runtime

**❌ Not Supported:**

- Cloudflare Workers/Pages
- Netlify Functions
- AWS Lambda
- Azure Functions

**Why not serverless?** This application needs:

1. Persistent browser instance (Playwright)
2. Native dependencies (Sharp, chromium)
3. Long-running processes (screenshots, image processing)
4. Persistent storage (caching)
5. Connection reuse (performance)

**Vercel Exception**: Vercel is fully supported through automatic environment detection and native platform integration.

### Environment Variables

All configurations are optional:

```env
# Image Proxy Security
ALLOWED_DOMAINS=example.com,cdn.example.com

# Caching (significantly improves performance)
REDIS_URL=redis://localhost:6379
```

See `.env.example` for all available options.

## 📄 License

MIT License - see [LICENSE](LICENSE) file for details.

---

Built with ❤️ by [By Sages](https://github.com/bysages)
