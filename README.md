# Lens

A high-performance image proxy and web services toolkit built with modern TypeScript. Lens provides a comprehensive suite of web utilities including image processing, screenshot capture, font serving, and more.

## 🚀 Features

### Core Services

- **🖼️ Image Proxy**: IPX-powered image processing with resize, format conversion, optimization
- **📸 Screenshot Capture**: Fast website screenshot service with browser pooling
- **🅰️ Font Service**: Google Fonts compatible API with multiple providers
- **🎨 Open Graph Images**: Dynamic OG image generation
- **🎯 Favicon Extraction**: Smart favicon extraction from websites
- **🔐 Authentication**: Better-auth integration with social login support

### Performance & Scalability

- **⚡ Multi-layer Caching**: Redis, file system, and cloud storage integration
- **🏊‍♂️ Connection Pooling**: Optimized browser and database pools
- **🛡️ Rate Limiting**: Unified rate limiting with plugin-level management
- **☁️ Cloud Native**: Support for Railway, Zeabur, and other persistent runtime platforms
- **🔄 Graceful Degradation**: Automatic fallbacks for missing services

## 📦 Quick Start

### Prerequisites

- Node.js 18+
- pnpm (recommended) or npm

### Installation

```bash
# Clone the repository
git clone https://github.com/bysages/lens.git
cd lens

# Install dependencies
pnpm install

# Copy environment configuration
cp env.example .env

# Generate a secret key
echo "BETTER_AUTH_SECRET=$(openssl rand -base64 32)" >> .env
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

### Essential Configuration

Only one environment variable is required:

```env
# Required: Authentication secret
BETTER_AUTH_SECRET=your-random-secret-here
```

### Optional Configuration

All other configurations are optional and will gracefully degrade:

```env
# Database (defaults to SQLite)
DATABASE_URL=postgresql://user:password@localhost:5432/lens

# OAuth Providers
GITHUB_CLIENT_ID=your-github-client-id
GITHUB_CLIENT_SECRET=your-github-client-secret

# Image proxy security
ALLOWED_DOMAINS=example.com,cdn.example.com

# Caching (improves performance)
REDIS_URL=redis://localhost:6379

# Cloud storage (for production)
# Note: Vercel Blob and Cloudflare R2 are supported for storage only
# but not for hosting due to serverless limitations
# VERCEL_BLOB_READ_WRITE_TOKEN=your-token
# CLOUDFLARE_R2_ACCOUNT_ID=your-account-id
```

See `env.example` for all available options.

## 📡 API Reference

### Authentication

Lens supports multiple authentication methods for API access:

#### 1. API Keys (Recommended for GET requests)

```bash
# Header authentication
curl -H "x-api-key: your_api_key_here" \
  "https://api.bysages.com/img/w_300,f_webp/https://example.com/image.jpg"

# Query parameter (less secure, but convenient)
curl "https://api.bysages.com/img/w_300,f_webp/https://example.com/image.jpg?api_key=your_api_key_here"

# Bearer token format (if API key format)
curl -H "Authorization: Bearer your_api_key_here" \
  "https://api.bysages.com/screenshot?url=https://example.com"
```

#### 2. Bearer Tokens (for session-based auth)

```bash
curl -H "Authorization: Bearer your_session_token" \
  "https://api.bysages.com/api/endpoint"
```

### Image Processing

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

# With API key authentication
curl -H "x-api-key: your_key" \
  "https://api.bysages.com/img/w_300,f_webp/https://example.com/image.jpg"
```

**Supported Modifiers:**

- `w_XXX` - Width
- `h_XXX` - Height
- `s_XXXxYYY` - Size (width x height)
- `f_FORMAT` - Format (webp, jpg, png, avif)
- `q_XXX` - Quality (1-100)
- `c_MODE` - Crop mode (fill, fit, pad)

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
- `fullPage` - Capture full page (true/false)
- `mobile` - Mobile viewport (true/false)
- `darkMode` - Dark mode (true/false)

### Font Service

Google Fonts compatible API:

```
GET /css?family={font_family}&display=swap
GET /css2?family={font_family}&display=swap
```

**Examples:**

```bash
# Basic font CSS
/css?family=Roboto:wght@400;700&display=swap

# Multiple fonts with weight ranges
/css2?family=Roboto:wght@200..800|Open+Sans:wght@300;400;600

# Font metadata
/webfonts?sort=popularity&category=sans-serif
```

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

## 🏗️ Architecture

Lens is built with modern web standards and follows clean architecture principles:

### Core Technologies

- **Runtime**: Node.js with Nitro
- **Language**: TypeScript with strict type safety
- **Authentication**: Better-auth with plugin system
- **Image Processing**: IPX with Sharp
- **Browser Automation**: Playwright with pool management
- **Caching**: Multi-layer with unstorage
- **Database**: Adaptive with Kysely (SQLite/PostgreSQL/MySQL/Turso)

### Design Principles

- **KISS (Keep It Simple)**: Simple, focused solutions over complex abstractions
- **DRY (Don't Repeat Yourself)**: Shared utilities and configurations
- **Graceful Degradation**: Fallbacks for missing dependencies
- **Type Safety**: Comprehensive TypeScript coverage
- **Performance First**: Optimized for speed and efficiency

## 🚀 Deployment

### Nitro Deployment

Lens is built with Nitro, which supports multiple deployment targets. For comprehensive deployment options and platform-specific configurations, please refer to the official [Nitro Deployment Guide](https://nitro.build/deploy).

**⚠️ Platform Compatibility Notice:**

This application requires a **persistent runtime environment** and **does not support serverless platforms** like:

- ❌ Vercel (Functions)
- ❌ Cloudflare Workers/Pages
- ❌ Netlify Functions
- ❌ AWS Lambda
- ❌ Azure Functions

**✅ Recommended platforms for persistent runtime:**

- Traditional VPS/Dedicated servers
- Docker containers
- Platform.sh
- Render.com
- DigitalOcean App Platform
- Heroku
- Any platform with persistent Node.js runtime

**Note:** While Railway and Zeabur may work with Nixpacks, they are not officially supported by Nitro. Use at your own discretion.

### Nixpacks Deployment

This project includes Nixpacks configuration for seamless deployment on platforms that support it. For comprehensive Nixpacks usage and platform-specific configurations, please refer to the [official Nixpacks documentation](https://nixpacks.com/docs/getting-started).

Nixpacks provides automatic deployment for platforms including:

- Railway
- Zeabur
- Render.com
- And other Nixpacks-compatible platforms

The included `nixpacks.toml` configuration provides:

- **System Dependencies**: vips, chromium, fontconfig for image processing and screenshot capabilities
- **Build Tools**: python3, gcc, gnumake for native module compilation
- **Package Manager**: pnpm for efficient dependency management

```toml
# nixpacks.toml
[phases.setup]
nixPkgs = [
  "...",
  "vips",        # Image processing (Sharp/IPX)
  "chromium",    # Screenshot service (Playwright)
  "fontconfig",  # Font rendering
  "python3",     # Native modules
  "gcc",
  "gnumake"
]

[phases.install]
cmds = ["pnpm install"]

[phases.build]
cmds = ["pnpm build"]

[start]
cmd = "pnpm preview"
```

### Why Not Serverless?

This application requires features that are incompatible with serverless environments:

1. **🏊‍♂️ Browser Pool Management**: Playwright browser instances need persistent memory and connection pooling
2. **📦 Native Dependencies**: Sharp, better-sqlite3, and chromium require filesystem access and binary execution
3. **🔄 Long-Running Processes**: Image processing and screenshot capture can exceed serverless timeout limits
4. **💾 Persistent Storage**: Database connections and cache systems need persistent runtime
5. **🎯 Connection Reuse**: Performance optimizations rely on keeping connections alive

**Recommended Platforms**: Render.com, Platform.sh, DigitalOcean App Platform, Heroku, Traditional VPS

### Environment Variables

Configure the following environment variables in your deployment platform:

```env
# Required
BETTER_AUTH_SECRET=your-random-secret-here

# Optional (for enhanced functionality)
DATABASE_URL=your-database-url
REDIS_URL=your-redis-url
# ... other environment variables from env.example
```

## 🤝 Contributing

We welcome contributions! Please see our [Contributing Guide](CONTRIBUTING.md) for details.

### Development Setup

```bash
# Fork and clone the repository
git clone https://github.com/yourusername/lens.git
cd lens

# Install dependencies
pnpm install

# Start development
pnpm dev

# Run linting
pnpm lint
```

## 📄 License

MIT License - see [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- [IPX](https://github.com/unjs/ipx) - High-performance image processing
- [Better-auth](https://github.com/better-auth/better-auth) - Modern authentication
- [Nitro](https://github.com/unjs/nitro) - Universal web server
- [Playwright](https://github.com/microsoft/playwright) - Browser automation
- [Sharp](https://github.com/lovell/sharp) - High-performance image processing
- [Unstorage](https://github.com/unjs/unstorage) - Universal storage layer

---

Built with ❤️ by [By Sages](https://github.com/bysages)
