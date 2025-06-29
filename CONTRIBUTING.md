# Contributing to Lens

Thank you for your interest in contributing to Lens! This guide focuses on development setup and contribution guidelines. For project overview and API usage, see [README.md](README.md).

## 🚀 Development Setup

### Prerequisites

- Node.js 18+
- pnpm 8+ (recommended package manager)
- Git

### Setup Development Environment

```bash
# Fork and clone the repository
git clone https://github.com/yourusername/lens.git
cd lens

# Install dependencies
pnpm install

# Copy environment configuration
cp env.example .env

# Generate a secret key
echo "BETTER_AUTH_SECRET=$(openssl rand -base64 32)" >> .env

# Start development server
pnpm dev
```

## 📁 Project Structure

```
lens/
├── server/
│   ├── routes/          # API route handlers
│   └── utils/           # Core business logic
│       ├── auth.ts      # Authentication configuration
│       ├── storage.ts   # Storage layer abstraction
│       ├── rate-limits.ts # Rate limiting configuration
│       ├── image.ts     # Image processing plugin
│       ├── screenshot.ts # Screenshot service
│       ├── fonts.ts     # Font service
│       ├── og.ts        # Open Graph images
│       └── favicon.ts   # Favicon extraction
├── public/              # Static assets
├── basis.config.ts      # Development toolkit config
├── nitro.config.ts      # Nitro server configuration
└── package.json         # Dependencies and scripts
```

## 🛠️ Development Principles

We follow these core principles established by our development toolkit:

### 1. KISS (Keep It Simple)

- Prefer simple, direct solutions over complex abstractions
- Avoid over-engineering unless genuinely needed
- Use native APIs when available

```typescript
// ✅ Good: Direct approach
const response = await fetch(url);
const data = await response.json();

// ❌ Bad: Unnecessary abstraction
class FetchWrapper {
  async complexFetchMethod(options: ComplexOptions) {
    // Over-engineered solution
  }
}
```

### 2. Single Responsibility

- Each function should have one clear purpose
- Separate concerns into focused modules

```typescript
// ✅ Good: Single responsibility
export async function calculateNewVersion(
  currentVersion: string,
  increment: VersionIncrement,
): Promise<string> {
  // Implementation
}

// ❌ Bad: Multiple responsibilities
export async function updateVersionAndCommitAndTag(options: ComplexOptions) {
  // Too many responsibilities
}
```

### 3. Graceful Degradation

- Always handle missing dependencies gracefully
- Provide meaningful fallbacks

```typescript
// ✅ Good: Graceful degradation
try {
  await executeOptionalFeature();
} catch (error) {
  console.warn("Optional feature unavailable, using fallback");
  await executeFallback();
}

// ❌ Bad: Assumes everything exists
await executeOptionalFeature(); // May throw
```

### 4. Clean Output

- Minimize verbose intermediate logging
- Show only essential completion messages

```typescript
// ✅ Good: Silent process with clear completion
// (Silent intermediate steps)
console.log("✅ Image processing completed successfully!");

// ❌ Bad: Verbose intermediate confirmations
console.log("Setting up image processor...");
console.log("Image processor ready!");
console.log("Processing image...");
console.log("Image processed!");
console.log("Image processing completed!"); // Redundant
```

## 🔧 Development Commands

```bash
# Core Development (from package.json)
pnpm dev                 # Start development server with hot reload
pnpm build              # Build for production
pnpm preview            # Preview production build
pnpm lint               # Run all linting checks (via basis)

# Manual Commands (when needed)
pnpm exec basis lint --staged    # Lint only staged files
pnpm exec basis lint --project   # Project-wide linting
pnpm exec basis version patch    # Version management
```

## 🧪 Testing

### Development Testing

1. **Plugin Integration**: Verify new plugins work with auth system
2. **Storage Layer**: Test cache and storage fallbacks
3. **Rate Limiting**: Confirm limits apply correctly
4. **Error Handling**: Test graceful degradation scenarios

### Local Testing Setup

```bash
# Start development server
pnpm dev

# Test basic functionality (see README.md for full API examples)
curl "http://localhost:3000/img/w_200/https://picsum.photos/400"

# Test authentication flows
curl -H "x-api-key: test_key" "http://localhost:3000/favicon?url=example.com"
```

## 📝 Code Style

We use automated tools for consistent code style:

- **ESLint**: For code linting and best practices
- **Prettier**: For code formatting (via oxlint)
- **TypeScript**: For type safety

### TypeScript Guidelines

- Use strict type checking
- Avoid `any` types
- Prefer interfaces over types for object shapes
- Use utility types when appropriate

```typescript
// ✅ Good: Proper typing
interface ImageOptions {
  width?: number;
  height?: number;
  format?: "png" | "jpeg" | "webp";
}

// ❌ Bad: Any type
function processImage(options: any) {
  // Implementation
}
```

## 🔌 Plugin Development

When creating new plugins for Better-auth:

### 1. Plugin Structure

```typescript
export const myPlugin = (): BetterAuthPlugin => {
  return {
    id: "my-plugin",

    rateLimit: pluginRateLimits.myPlugin,

    endpoints: {
      myEndpoint: createAuthEndpoint(
        "/my-plugin/endpoint",
        { method: "GET" },
        async (ctx) => {
          // Implementation
        },
      ),
    },
  };
};
```

### 2. Rate Limiting

- Add rate limits to `rate-limits.ts`
- Use the unified configuration system
- Consider different limits for authenticated vs unauthenticated users

### 3. Error Handling

- Use consistent error responses
- Provide helpful error messages
- Handle edge cases gracefully

## 🗂️ Storage Integration

When working with storage:

1. Use the unified storage system in `storage.ts`
2. Implement proper caching strategies with 24-hour defaults
3. Handle storage failures gracefully
4. Consider performance implications

### Caching Best Practices

- Use the standardized 24-hour cache TTL for most operations
- Static assets (fonts, favicons) can use longer cache periods (7-30 days)
- Always include `X-Cache` headers to indicate cache status
- Consider cache invalidation strategies for dynamic content

```typescript
// ✅ Good: Proper caching implementation
await cacheStorage.screenshots.set(cacheKey, screenshotBuffer); // Uses 24h default
return new Response(screenshotBuffer, {
  headers: {
    "Content-Type": contentType,
    "Cache-Control": "public, max-age=86400", // 24 hours
    "X-Cache": "MISS",
  },
});

// ❌ Bad: No caching consideration
return new Response(screenshotBuffer, {
  headers: { "Content-Type": contentType },
});
```

## 🚦 Rate Limiting

- Follow the patterns in `rate-limits.ts`
- Distinguish between authenticated and unauthenticated limits
- Consider the resource intensity of operations

## 📋 Pull Request Process

1. **Fork the repository** and create a feature branch
2. **Make your changes** following the guidelines above
3. **Test thoroughly** with various inputs and edge cases
4. **Write clear commit messages** using conventional commits:
   - `feat:` for new features
   - `fix:` for bug fixes
   - `docs:` for documentation
   - `refactor:` for code improvements
   - `perf:` for performance improvements

5. **Submit a pull request** with:
   - Clear description of changes
   - Screenshots/examples if UI related
   - Performance considerations if applicable

### Commit Message Format

```
type(scope): description

[optional body]

[optional footer]
```

Examples:

```
feat(image): add WebP support for image processing
fix(screenshot): handle timeout errors gracefully
docs(readme): update API examples
refactor(storage): unify cache configuration
```

## 🐛 Reporting Issues

When reporting bugs:

1. **Check existing issues** first
2. **Provide minimal reproduction** steps
3. **Include environment details**:
   - Node.js version
   - Operating system
   - Package manager version
4. **Share relevant logs** or error messages

## 🆘 Getting Help

- **GitHub Issues**: For bugs and feature requests
- **GitHub Discussions**: For questions and community support
- **Documentation**: Check README.md and code comments

## 📄 License

By contributing to Lens, you agree that your contributions will be licensed under the MIT License.

---

Thank you for contributing to Lens! 🎉
