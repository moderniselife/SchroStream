import { chromium, Browser, Page, BrowserContext } from 'playwright';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

const COOKIES_FILE = join(process.cwd(), 'data', 'netflix-cookies.json');
const USER_DATA_DIR = join(process.cwd(), 'data', 'netflix-profile');

interface NetflixCookies {
  cookies: any[];
  savedAt: number;
}

interface NetflixContent {
  id: string;
  title: string;
  description?: string;
  imageUrl?: string;
  type: 'movie' | 'series';
  duration?: number;
}

class NetflixClient {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private isAuthenticated = false;

  async initialize(): Promise<void> {
    console.log('[Netflix] Initializing browser...');
    
    // Ensure data directory exists
    const dataDir = join(process.cwd(), 'data');
    if (!existsSync(dataDir)) {
      mkdirSync(dataDir, { recursive: true });
    }

    // Launch browser with persistent context to maintain login
    this.browser = await chromium.launch({
      headless: false, // Must be false for Widevine DRM
      args: [
        '--enable-features=NetworkService,NetworkServiceInProcess',
        '--disable-blink-features=AutomationControlled',
        '--disable-dev-shm-usage',
      ],
    });

    // Create context with saved cookies if available
    const contextOptions: any = {
      viewport: { width: 1920, height: 1080 },
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36',
      locale: 'en-AU',
    };

    // Load saved cookies if available
    if (existsSync(COOKIES_FILE)) {
      try {
        const data = readFileSync(COOKIES_FILE, 'utf-8');
        const savedData: NetflixCookies = JSON.parse(data);
        
        // Check if cookies are less than 30 days old
        if (Date.now() - savedData.savedAt < 30 * 24 * 60 * 60 * 1000) {
          contextOptions.storageState = { cookies: savedData.cookies, origins: [] };
          console.log('[Netflix] Loaded saved cookies');
        }
      } catch (error) {
        console.error('[Netflix] Failed to load cookies:', error);
      }
    }

    this.context = await this.browser.newContext(contextOptions);
    this.page = await this.context.newPage();

    // Check if already authenticated
    await this.checkAuthentication();
  }

  private async checkAuthentication(): Promise<boolean> {
    if (!this.page) return false;

    try {
      await this.page.goto('https://www.netflix.com/browse', { waitUntil: 'domcontentloaded', timeout: 10000 });
      
      // If we're on the browse page, we're authenticated
      const url = this.page.url();
      this.isAuthenticated = url.includes('/browse');
      
      if (this.isAuthenticated) {
        console.log('[Netflix] Already authenticated');
        await this.saveCookies();
      } else {
        console.log('[Netflix] Not authenticated, login required');
      }

      return this.isAuthenticated;
    } catch (error) {
      console.error('[Netflix] Authentication check failed:', error);
      return false;
    }
  }

  async login(email?: string, password?: string): Promise<boolean> {
    if (!this.page) {
      throw new Error('Browser not initialized');
    }

    if (this.isAuthenticated) {
      console.log('[Netflix] Already logged in');
      return true;
    }

    try {
      console.log('[Netflix] Navigating to login page...');
      await this.page.goto('https://www.netflix.com/login', { waitUntil: 'networkidle' });

      if (email && password) {
        // Automated login
        await this.page.fill('input[name="userLoginId"]', email);
        await this.page.fill('input[name="password"]', password);
        await this.page.click('button[type="submit"]');
        
        // Wait for navigation
        await this.page.waitForURL('**/browse**', { timeout: 30000 });
      } else {
        // Manual login - wait for user to log in
        console.log('[Netflix] Please log in manually in the browser window...');
        console.log('[Netflix] Waiting for login to complete...');
        
        await this.page.waitForURL('**/browse**', { timeout: 120000 }); // 2 minute timeout
      }

      this.isAuthenticated = true;
      await this.saveCookies();
      console.log('[Netflix] Login successful!');
      return true;
    } catch (error) {
      console.error('[Netflix] Login failed:', error);
      return false;
    }
  }

  private async saveCookies(): Promise<void> {
    if (!this.context) return;

    try {
      const cookies = await this.context.cookies();
      const data: NetflixCookies = {
        cookies,
        savedAt: Date.now(),
      };
      writeFileSync(COOKIES_FILE, JSON.stringify(data, null, 2));
      console.log('[Netflix] Cookies saved');
    } catch (error) {
      console.error('[Netflix] Failed to save cookies:', error);
    }
  }

  async search(query: string): Promise<NetflixContent[]> {
    if (!this.page || !this.isAuthenticated) {
      throw new Error('Not authenticated');
    }

    try {
      console.log(`[Netflix] Searching for: ${query}`);
      
      // Navigate to search
      await this.page.goto(`https://www.netflix.com/search?q=${encodeURIComponent(query)}`, {
        waitUntil: 'networkidle',
      });

      // Wait for results
      await this.page.waitForSelector('.title-card', { timeout: 10000 });

      // Extract search results
      const results = await this.page.evaluate(() => {
        const cards = Array.from(document.querySelectorAll('.title-card'));
        return cards.slice(0, 10).map((card: any) => {
          const link = card.querySelector('a');
          const img = card.querySelector('img');
          const title = img?.getAttribute('alt') || '';
          const href = link?.getAttribute('href') || '';
          const id = href.match(/\/(\d+)/)?.[1] || '';

          return {
            id,
            title,
            imageUrl: img?.getAttribute('src') || '',
            type: 'movie' as const, // We'll determine this later
          };
        });
      });

      console.log(`[Netflix] Found ${results.length} results`);
      return results;
    } catch (error) {
      console.error('[Netflix] Search failed:', error);
      return [];
    }
  }

  async getRecommendations(): Promise<NetflixContent[]> {
    if (!this.page || !this.isAuthenticated) {
      throw new Error('Not authenticated');
    }

    try {
      console.log('[Netflix] Getting recommendations...');
      
      await this.page.goto('https://www.netflix.com/browse', { waitUntil: 'networkidle' });
      await this.page.waitForSelector('.title-card', { timeout: 10000 });

      const results = await this.page.evaluate(() => {
        const cards = Array.from(document.querySelectorAll('.title-card'));
        return cards.slice(0, 20).map((card: any) => {
          const link = card.querySelector('a');
          const img = card.querySelector('img');
          const title = img?.getAttribute('alt') || '';
          const href = link?.getAttribute('href') || '';
          const id = href.match(/\/(\d+)/)?.[1] || '';

          return {
            id,
            title,
            imageUrl: img?.getAttribute('src') || '',
            type: 'movie' as const,
          };
        });
      });

      console.log(`[Netflix] Found ${results.length} recommendations`);
      return results;
    } catch (error) {
      console.error('[Netflix] Failed to get recommendations:', error);
      return [];
    }
  }

  async play(contentId: string): Promise<string | null> {
    if (!this.page || !this.isAuthenticated) {
      throw new Error('Not authenticated');
    }

    try {
      console.log(`[Netflix] Playing content: ${contentId}`);
      
      // Navigate to watch page
      const watchUrl = `https://www.netflix.com/watch/${contentId}`;
      await this.page.goto(watchUrl, { waitUntil: 'networkidle' });

      // Wait for video player to load
      await this.page.waitForSelector('video', { timeout: 30000 });

      console.log('[Netflix] Video player loaded');
      
      // Return the page URL for stream capture
      return watchUrl;
    } catch (error) {
      console.error('[Netflix] Failed to play content:', error);
      return null;
    }
  }

  async captureStream(contentId: string): Promise<{ videoUrl: string; audioUrl: string } | null> {
    if (!this.page) {
      throw new Error('Browser not initialized');
    }

    try {
      // Start playing
      const watchUrl = await this.play(contentId);
      if (!watchUrl) return null;

      // Capture network requests for manifest
      const manifestPromise = this.page.waitForRequest(
        (request) => request.url().includes('.m3u8') || request.url().includes('manifest'),
        { timeout: 30000 }
      );

      const manifestRequest = await manifestPromise;
      const manifestUrl = manifestRequest.url();

      console.log('[Netflix] Captured manifest URL:', manifestUrl.substring(0, 100) + '...');

      // For now, return the manifest URL
      // In production, you'd parse the manifest and extract video/audio URLs
      return {
        videoUrl: manifestUrl,
        audioUrl: manifestUrl,
      };
    } catch (error) {
      console.error('[Netflix] Failed to capture stream:', error);
      return null;
    }
  }

  async close(): Promise<void> {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
      this.context = null;
      this.page = null;
      this.isAuthenticated = false;
      console.log('[Netflix] Browser closed');
    }
  }

  getPage(): Page | null {
    return this.page;
  }

  isLoggedIn(): boolean {
    return this.isAuthenticated;
  }
}

// Singleton instance
let netflixClientInstance: NetflixClient | null = null;

export function getNetflixClient(): NetflixClient {
  if (!netflixClientInstance) {
    netflixClientInstance = new NetflixClient();
  }
  return netflixClientInstance;
}

export default NetflixClient;
