/**
 * Simple resource cleanup system (KISS principle)
 * Focus on application-level resource management only
 */

// Simple resource cleanup manager
class ResourceManager {
  private cleanupCallbacks: Array<() => Promise<void>> = [];

  /**
   * Register cleanup callback for application resources
   */
  registerCleanup(callback: () => Promise<void>): void {
    this.cleanupCallbacks.push(callback);
  }

  /**
   * Execute all registered cleanup callbacks
   */
  async cleanup(): Promise<void> {
    const cleanupPromises = this.cleanupCallbacks.map((callback) =>
      callback().catch((error) => {
        console.warn("Cleanup callback failed:", error);
      }),
    );

    await Promise.allSettled(cleanupPromises);
  }

  /**
   * Simple memory pressure check (basic threshold only)
   */
  isMemoryPressure(): boolean {
    const usage = process.memoryUsage();
    const heapUsageRatio = usage.heapUsed / usage.heapTotal;
    return heapUsageRatio > 0.85; // Simple 85% threshold
  }

  /**
   * Get cleanup callbacks count for debugging
   */
  getCleanupCount(): number {
    return this.cleanupCallbacks.length;
  }
}

// Global resource manager instance
const resourceManager = new ResourceManager();

// Helper functions for easy usage
export const registerCleanup = (callback: () => Promise<void>) =>
  resourceManager.registerCleanup(callback);

export const isMemoryPressure = () => resourceManager.isMemoryPressure();

// Periodic cleanup every 10 minutes (simple interval)
setInterval(
  () => {
    resourceManager.cleanup().catch(console.error);
  },
  10 * 60 * 1000,
);
