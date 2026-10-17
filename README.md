# Lens

![GitHub](https://img.shields.io/github/license/bysages/lens)
[![Contributor Covenant](https://img.shields.io/badge/Contributor%20Covenant-2.1-4baaaa.svg)](https://www.contributor-covenant.org/version/2/1/code_of_conduct/)

> A high-performance image proxy and web services toolkit built with modern TypeScript. Lens provides a comprehensive suite of web utilities including image processing, screenshot capture, font serving, and more.

## 🚀 Features

### Core Services

- **🖼️ Image Proxy**: UnImage-powered image processing with resize, format conversion, optimization
- **📸 Screenshot Capture**: Fast website screenshot service with resource optimization
- **📄 Reader**: Article content extraction (Markdown/HTML) with Readability
- **🅰️ Font Service**: Google Fonts compatible API with multiple providers
- **🎨 Open Graph Images**: Dynamic OG image generation
- **🎯 Favicon Extraction**: Smart favicon extraction from websites
- **👤 Gravatar Proxy**: Cached Gravatar avatar proxy with email or hash input
- **🤖 MCP Server**: Model Context Protocol server exposing all services as tools via JSON-RPC 2.0

### Performance & Scalability

- **⚡ Redis Caching**: Redis-powered caching with 24-hour intelligent caching
- **🧭 On-Demand Browser**: Moli headless browser (Rust) driven over CDP — ~1/10 the memory of Chromium
- **🛡️ Rate Limiting**: Rate limiting for expensive operations
- **🔒 SSRF Protection**: URL validation with DNS resolution checks, plus browser-level private-network blocking
- **🔄 Graceful Degradation**: Automatic fallbacks for missing services

## 📦 Quick Start

### Prerequisites

- Node.js 22+
- pnpm 10+ (recommended) or npm
- [Moli](https://github.com/lexmount/moli) headless browser (screenshot/reader connect to it over CDP)

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
# Start the Moli browser server (default CDP endpoint: http://127.0.0.1:9222)
moli serve --layout --resource

# In another terminal, start development server
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

# Set only when requests arrive through a trusted reverse proxy
TRUST_PROXY=1

# Requests per IP within RATE_WINDOW seconds; Redis makes these cluster-wide
BROWSER_RATE_LIMIT=20
FAVICON_RATE_LIMIT=30
IMAGE_RATE_LIMIT=120
GRAVATAR_RATE_LIMIT=120
RATE_WINDOW=60

# Caching (significantly improves performance)
REDIS_URL=redis://localhost:6379

# Browser: Moli CDP endpoint (defaults to http://127.0.0.1:9222)
BROWSER_CDP_ENDPOINT=http://127.0.0.1:9222

# Browser: optional user-agent overrides (default: the engine's own UA)
#BROWSER_USER_AGENT=...
#BROWSER_USER_AGENT_MOBILE=...

# Browser: cluster-wide maximum with Redis (process-local fallback otherwise)
BROWSER_MAX_CONCURRENCY=4

# Maximum wait for a global browser slot (ms)
BROWSER_QUEUE_TIMEOUT=15000

# Reject full-page captures above this CSS pixel count
SCREENSHOT_MAX_PIXELS=24000000

# Cluster: worker count (Docker defaults to 2; raw Nitro defaults to CPU count)
NITRO_CLUSTER_WORKERS=2
```

See `.env.example` for all available options.

## 📡 API Reference

All cached responses include `X-Cache` headers (HIT/MISS) and `ETag` headers for conditional 304 responses.

### Images

#### Image Proxy

Transform and optimize images with [UnImage](https://www.npmjs.com/package/unimage), using IPX-compatible URLs:

```
GET /img/{modifiers}/{image_url}
```

**Examples:**

```bash
# Resize to 300px width, negotiate the best supported format
https://api.bysages.com/img/w_300,f_auto/https://example.com/image.jpg

# Explicit WebP output
https://api.bysages.com/img/w_300,f_webp/https://example.com/image.jpg

# Create a 200x200 cover thumbnail
https://api.bysages.com/img/s_200x200,q_80/https://example.com/image.png

# Rotate and desaturate
https://api.bysages.com/img/rotate_90,grayscale/https://example.com/photo.jpg

# Pass through a local /public asset without modifiers
https://api.bysages.com/img/_/favicon.svg
```

**Common Modifiers:**

- `w_XXX` / `h_XXX` - Width / height
- `s_XXXxYYY` - Size shorthand
- `fit_contain|cover|fill|outside` - Fit mode
- `f_FORMAT` - Output format (`webp`, `jpg`, `png`, `avif`, `svg`, `gif`, and more; `f_auto` negotiates by `Accept`)
- `q_XXX` - Quality
- `rotate_90`, `grayscale`, `blur_2`, `sharpen_1`, `animated` - Common transforms
- `_/path` - Modifier-less passthrough

The server stack uses SVGO for SVG, Canvas for supported operations, and Sharp as the raster fallback. Remote images are protected by domain allowlists, DNS/private-address checks, and redirect validation. Local paths stay inside `public`. Responses use Redis-backed caching, strong ETags, 304s, and `Vary: Accept` for negotiated formats.

#### Screenshot Capture

Capture website screenshots with Playwright-aligned options:

```
GET /screenshot?url={website_url}&options
```

**Examples:**

```bash
# Basic screenshot
https://api.bysages.com/screenshot?url=https://example.com

# JPEG with custom quality
https://api.bysages.com/screenshot?url=https://example.com&type=jpeg&quality=80

# Mobile screenshot with custom viewport
https://api.bysages.com/screenshot?url=https://example.com&width=375&height=667&mobile=true

# Full page capture
https://api.bysages.com/screenshot?url=https://example.com&fullPage=true

# Clip region (x,y,width,height)
https://api.bysages.com/screenshot?url=https://example.com&clip=0,0,400,300

# Disable animations for clean capture
https://api.bysages.com/screenshot?url=https://example.com&animations=disabled

# Custom CSS scale
https://api.bysages.com/screenshot?url=https://example.com&scale=css

# Inject custom stylesheet
https://api.bysages.com/screenshot?url=https://example.com&style=body{background:red}
```

**Parameters:**

| Parameter    | Description                                                           | Default    |
| ------------ | --------------------------------------------------------------------- | ---------- |
| `url`        | Website URL (required)                                                | -          |
| `width`      | Viewport width (100-2560)                                             | 1280       |
| `height`     | Viewport height (100-1440)                                            | 720        |
| `type`       | Output format (`png`, `jpeg`)                                         | `png`      |
| `quality`    | Image quality, 1-100 (jpeg only)                                      | -          |
| `fullPage`   | Capture full scrollable page (`true`/`false`)                         | `false`    |
| `clip`       | Clip region as `x,y,width,height`                                     | -          |
| `scale`      | Screenshot scale (`css` for CSS pixels, `device` for device pixels)   | `device`   |
| `animations` | Animation handling (`disabled` or `allow`)                            | `disabled` |
| `caret`      | Text caret (`hide` or `initial`)                                      | `hide`     |
| `style`      | Custom CSS stylesheet to apply                                        | -          |
| `timeout`    | Navigation timeout in ms (1000-30000)                                 | 10000      |
| `mobile`     | Mobile viewport (`true`/`false`)                                      | `false`    |
| `darkMode`   | Dark mode (`true`/`false`)                                            | `false`    |
| `waitUntil`  | Navigation wait condition (`load`, `domcontentloaded`, `networkidle`) | `load`     |
| `delay`      | Additional delay in ms after page load (0-10000)                      | -          |

**Performance Notes:**

- Screenshots are cached for 1 day with rate limiting
- Identical requests return cached results with sub-second response times
- Screenshots wait briefly for fonts and images, and freeze animations by default
- Moli renders full-page captures as one bitmap; `SCREENSHOT_MAX_PIXELS` rejects oversized captures
- `BROWSER_MAX_CONCURRENCY` is cluster-wide with Redis and includes a bounded queue

#### Open Graph Images

Generate dynamic OG images:

```
GET /og?title={title}&description={description}
```

**Examples:**

```bash
# Basic OG image
https://api.bysages.com/og?title=Welcome&description=Get%20started%20with%20Lens

# Custom styling
https://api.bysages.com/og?title=Hello%20World&theme=dark&fontSize=72&width=1200&height=630
```

**Caching:**

- Generated OG images are cached for 24 hours
- Identical requests with same parameters return cached results instantly

### Web Services

#### Reader (Content Extraction)

Extract rendered Markdown or HTML content from any URL:

```
GET /reader?url={website_url}&options
```

**Examples:**

```bash
# Extract rendered Markdown (default)
https://api.bysages.com/reader?url=https://github.com/bysages/lens

# Get HTML instead
https://api.bysages.com/reader?url=https://github.com/bysages/lens&format=html

# Wait for full page load
https://api.bysages.com/reader?url=https://github.com/bysages/lens&waitUntil=load
```

**Parameters:**

| Parameter   | Description                                                           | Default            |
| ----------- | --------------------------------------------------------------------- | ------------------ |
| `url`       | Website URL (required)                                                | -                  |
| `format`    | Output format (`html`, `markdown`)                                    | `markdown`         |
| `waitUntil` | Navigation wait condition (`load`, `domcontentloaded`, `networkidle`) | `domcontentloaded` |
| `delay`     | Additional delay in ms after page load (0-10000)                      | -                  |
| `timeout`   | Navigation timeout in ms (1000-30000)                                 | 10000              |

#### Favicon Extraction

Extract high-quality favicons:

```
GET /favicon?url={website_url}&size={size}
```

**Examples:**

```bash
# Extract favicon
https://api.bysages.com/favicon?url=github.com

# Custom size
https://api.bysages.com/favicon?url=github.com&size=64
```

**Features:**

- Smart favicon extraction from multiple sources (PWA manifests, Apple touch icons, HTML tags)
- 30-day server-side caching with ETag/304 support
- Automatic fallback to generated favicon if none found

#### Gravatar Proxy

Get Gravatar avatars by email, MD5 hash, or path. All query parameters (except `email`/`hash`) are forwarded directly to Gravatar. You can switch from Gravatar by simply replacing the URL prefix.

```
GET /gravatar/{md5}?{gravatar_params}
GET /gravatar?email={email}
GET /gravatar?hash={md5}&{gravatar_params}
```

**Examples:**

```bash
# By path (drop-in replacement for Gravatar URLs)
https://api.bysages.com/gravatar/{md5}?size=200

# By email
https://api.bysages.com/gravatar?email=user@example.com

# By MD5 hash
https://api.bysages.com/gravatar?hash={md5}

# With Gravatar parameters
https://api.bysages.com/gravatar?email=user@example.com&size=200&default=identicon&rating=pg
```

**Parameters:**

- `{md5}` - MD5 hash in URL path (drop-in replacement mode)
- `email` - Email address (will be MD5 hashed automatically)
- `hash` - Pre-computed MD5 hash (alternative to email)
- All other parameters are forwarded to [Gravatar API](https://docs.gravatar.com/api/images/)

#### MCP Server

Model Context Protocol server exposing all Lens services as tools via JSON-RPC 2.0 over HTTP.

```
POST /mcp
```

**Setup with Claude Desktop** (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "lens": {
      "url": "https://api.bysages.com/mcp"
    }
  }
}
```

**Available Tools:**

| Tool         | Description                                             | Returns |
| ------------ | ------------------------------------------------------- | ------- |
| `reader`     | Extract article content from a URL (Markdown/HTML)      | text    |
| `screenshot` | Capture a screenshot of a website                       | image   |
| `favicon`    | Extract a website's favicon                             | image   |
| `og`         | Generate a dynamic Open Graph image                     | image   |
| `gravatar`   | Get a Gravatar avatar by email or hash                  | image   |
| `img`        | Transform and optimize an image (resize, crop, convert) | image   |

### Fonts

#### Font Service

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
https://api.bysages.com/css?family=Roboto:wght@400;700|Open+Sans:wght@300;400;600&display=swap

# Multiple fonts (v2 API - repeated family parameter)
https://api.bysages.com/css2?family=Inter:wght@400;700&family=Roboto:wght@300;400&display=swap

# Variable fonts with weight range (v2 only)
https://api.bysages.com/css2?family=Inter:wght@200..800&display=swap

# Font metadata
https://api.bysages.com/webfonts?sort=popularity&category=sans-serif
```

**Recommendations:**

- Use `/css` for **legacy compatibility** with old Google Fonts syntax
- Use `/css2` for **modern applications** with variable fonts and better optimization
- Both endpoints support all font providers (Google, Bunny, Fontshare, Fontsource)

## 🏗️ Architecture

Lens is built with modern web standards and follows clean architecture principles:

### Core Technologies

- **Runtime**: Node.js 22+ with Nitro
- **Language**: TypeScript with strict type safety
- **Image Proxy**: UnImage with SVGO, Canvas, and Sharp
- **Browser Automation**: [Moli](https://github.com/lexmount/moli) headless browser driven over CDP by Playwright
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
- **Redis** (bundled in Docker Compose; optional for other setups)

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

`GET /healthz` reports liveness including browser (CDP) availability — the
compose healthcheck and orchestrator probes should point at it.

The stack includes:

- **Lens** application on port 3000, with the Moli browser running inside the container
- **Redis** for distributed caching, bounded with LRU eviction (512 MB)

#### Option 2: Using Docker Run

```bash
# Pull the official image
docker pull bysages/lens:latest

# Run container with host network (recommended for accurate IP logging);
# --init is needed because the image runs Moli alongside Node
docker run -d \
  --name lens \
  --network host \
  --init \
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
  --init \
  --env-file .env \
  --restart unless-stopped \
  lens
```

### Environment Variables

All configurations are optional:

```env
# Image Proxy Security
ALLOWED_DOMAINS=example.com,cdn.example.com

# Set only when requests arrive through a trusted reverse proxy
TRUST_PROXY=1

# Caching (significantly improves performance)
REDIS_URL=redis://localhost:6379

# Browser: Moli CDP endpoint (defaults to http://127.0.0.1:9222)
BROWSER_CDP_ENDPOINT=http://127.0.0.1:9222

# Browser: cluster-wide maximum with Redis (process-local fallback otherwise)
BROWSER_MAX_CONCURRENCY=4

# Maximum wait for a global browser slot (ms)
BROWSER_QUEUE_TIMEOUT=15000

# Reject full-page captures above this CSS pixel count
SCREENSHOT_MAX_PIXELS=24000000

# Cluster: worker count (Docker defaults to 2; raw Nitro defaults to CPU count)
NITRO_CLUSTER_WORKERS=2

# Moli server flags used by the Docker entrypoint
# (--block-private-networks is always enforced by the entrypoint)
MOLI_FLAGS=--layout --resource --http-cache-dir=/tmp/lens-cache/moli-http --http-max-concurrent=32 --http-max-total-connections=64
```

See `.env.example` for all available options.

## 📄 License

MIT License - see [LICENSE](LICENSE) file for details.

---

Built with ❤️ by [By Sages](https://github.com/bysages)
