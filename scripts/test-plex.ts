import { config } from 'dotenv';
config();

const PLEX_URL = process.env.PLEX_URL?.replace(/\/$/, '') || 'http://localhost:32400';
const PLEX_TOKEN = process.env.PLEX_TOKEN || '';

if (!PLEX_TOKEN) {
  console.error('❌ PLEX_TOKEN not set in .env');
  process.exit(1);
}

async function testEndpoint(name: string, endpoint: string): Promise<any> {
  const url = `${PLEX_URL}${endpoint}${endpoint.includes('?') ? '&' : '?'}X-Plex-Token=${PLEX_TOKEN}`;
  
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Testing: ${name}`);
  console.log(`URL: ${PLEX_URL}${endpoint}`);
  console.log(`${'='.repeat(60)}`);
  
  try {
    const response = await fetch(url, {
      headers: { Accept: 'application/json' }
    });
    
    if (!response.ok) {
      console.log(`❌ HTTP ${response.status}: ${response.statusText}`);
      return null;
    }
    
    const data = await response.json();
    console.log(`✅ Success!`);
    return data;
  } catch (error) {
    console.log(`❌ Error: ${error}`);
    return null;
  }
}

async function main() {
  console.log('🔍 Plex API Endpoint Tester');
  console.log(`Server: ${PLEX_URL}`);
  
  // Test 1: Server info
  const serverInfo = await testEndpoint('Server Info', '/');
  if (serverInfo) {
    console.log(`Server: ${serverInfo.MediaContainer?.friendlyName}`);
  }
  
  // Test 2: Libraries
  const libraries = await testEndpoint('Libraries', '/library/sections');
  if (libraries?.MediaContainer?.Directory) {
    const dirs = Array.isArray(libraries.MediaContainer.Directory) 
      ? libraries.MediaContainer.Directory 
      : [libraries.MediaContainer.Directory];
    
    console.log('\nLibraries found:');
    for (const lib of dirs) {
      console.log(`  - [${lib.key}] ${lib.title} (${lib.type})`);
    }
    
    // Test 3: Search in each library
    const searchQuery = 'breaking bad';
    
    for (const lib of dirs) {
      // Test library contents
      const contents = await testEndpoint(
        `Library ${lib.key} (${lib.title}) - All items`,
        `/library/sections/${lib.key}/all`
      );
      
      if (contents?.MediaContainer?.Metadata) {
        const items = Array.isArray(contents.MediaContainer.Metadata)
          ? contents.MediaContainer.Metadata
          : [contents.MediaContainer.Metadata];
        console.log(`  Found ${items.length} items in library`);
        
        // Show first few items
        for (const item of items.slice(0, 5)) {
          console.log(`    - ${item.title} (${item.type})`);
        }
        if (items.length > 5) {
          console.log(`    ... and ${items.length - 5} more`);
        }
      }
      
      // Test search endpoint for this library
      const search1 = await testEndpoint(
        `Library ${lib.key} - Search (type=1, movies)`,
        `/library/sections/${lib.key}/search?type=1&query=${encodeURIComponent(searchQuery)}`
      );
      if (search1?.MediaContainer?.Metadata) {
        const items = Array.isArray(search1.MediaContainer.Metadata)
          ? search1.MediaContainer.Metadata
          : [search1.MediaContainer.Metadata];
        console.log(`  Found ${items.length} results`);
        for (const item of items) {
          console.log(`    - ${item.title}`);
        }
      }
      
      const search2 = await testEndpoint(
        `Library ${lib.key} - Search (type=2, shows)`,
        `/library/sections/${lib.key}/search?type=2&query=${encodeURIComponent(searchQuery)}`
      );
      if (search2?.MediaContainer?.Metadata) {
        const items = Array.isArray(search2.MediaContainer.Metadata)
          ? search2.MediaContainer.Metadata
          : [search2.MediaContainer.Metadata];
        console.log(`  Found ${items.length} results`);
        for (const item of items) {
          console.log(`    - ${item.title}`);
        }
      }
    }
    
    // Test 4: Global search
    const globalSearch = await testEndpoint(
      'Global Search',
      `/search?query=${encodeURIComponent(searchQuery)}`
    );
    if (globalSearch?.MediaContainer?.Metadata) {
      const items = Array.isArray(globalSearch.MediaContainer.Metadata)
        ? globalSearch.MediaContainer.Metadata
        : [globalSearch.MediaContainer.Metadata];
      console.log(`  Found ${items.length} global results`);
      for (const item of items) {
        console.log(`    - ${item.title} (${item.type})`);
      }
    }

    // Test 5: Hub search (used by Plex UI)
    const hubSearch = await testEndpoint(
      'Hub Search (Plex UI style)',
      `/hubs/search?query=${encodeURIComponent(searchQuery)}`
    );
    if (hubSearch?.MediaContainer?.Hub) {
      const hubs = Array.isArray(hubSearch.MediaContainer.Hub)
        ? hubSearch.MediaContainer.Hub
        : [hubSearch.MediaContainer.Hub];
      
      for (const hub of hubs) {
        if (hub.Metadata) {
          const items = Array.isArray(hub.Metadata) ? hub.Metadata : [hub.Metadata];
          console.log(`  ${hub.title}: ${items.length} results`);
          for (const item of items.slice(0, 3)) {
            console.log(`    - ${item.title} (${item.type})`);
          }
        }
      }
    }
  }
  
  // Test 6: Get stream URL for Breaking Bad
  console.log('\n' + '='.repeat(60));
  console.log('Testing: Get Stream URL for a show');
  console.log('='.repeat(60));
  
  // Find Breaking Bad first
  const showSearch = await testEndpoint(
    'Find Breaking Bad',
    `/library/sections/5/search?type=2&query=breaking%20bad`
  );
  
  if (showSearch?.MediaContainer?.Metadata) {
    const show = Array.isArray(showSearch.MediaContainer.Metadata)
      ? showSearch.MediaContainer.Metadata[0]
      : showSearch.MediaContainer.Metadata;
    
    console.log(`\nFound show: ${show.title} (ratingKey: ${show.ratingKey})`);
    
    // Get episodes
    const episodes = await testEndpoint(
      'Get Episodes',
      `/library/metadata/${show.ratingKey}/allLeaves`
    );
    
    if (episodes?.MediaContainer?.Metadata) {
      const ep = Array.isArray(episodes.MediaContainer.Metadata)
        ? episodes.MediaContainer.Metadata[0]
        : episodes.MediaContainer.Metadata;
      
      console.log(`\nFirst episode: ${ep.title} (ratingKey: ${ep.ratingKey})`);
      
      // Get episode metadata with Media info
      const epMeta = await testEndpoint(
        'Get Episode Metadata',
        `/library/metadata/${ep.ratingKey}`
      );
      
      if (epMeta?.MediaContainer?.Metadata) {
        const epData = Array.isArray(epMeta.MediaContainer.Metadata)
          ? epMeta.MediaContainer.Metadata[0]
          : epMeta.MediaContainer.Metadata;
        
        console.log('\nMedia info:');
        console.log(JSON.stringify(epData.Media, null, 2));
        
        if (epData.Media) {
          const media = Array.isArray(epData.Media) ? epData.Media[0] : epData.Media;
          const part = Array.isArray(media.Part) ? media.Part[0] : media.Part;
          
          console.log('\nPart info:');
          console.log(`  key: ${part.key}`);
          console.log(`  file: ${part.file}`);
          console.log(`  container: ${part.container}`);
          
          // Test direct file URL (often fails with remote mounts)
          const directUrl = `${PLEX_URL}${part.key}?X-Plex-Token=${PLEX_TOKEN}`;
          console.log(`\nDirect URL: ${directUrl}`);
          
          console.log('\nTesting direct URL...');
          try {
            const directResponse = await fetch(directUrl, { method: 'HEAD' });
            console.log(`  Status: ${directResponse.status} ${directResponse.statusText}`);
          } catch (err) {
            console.log(`  Error: ${err}`);
          }
          
          // Test download URL (should always work)
          const downloadUrl = `${PLEX_URL}/library/metadata/${ep.ratingKey}/file?X-Plex-Token=${PLEX_TOKEN}`;
          console.log(`\nDownload URL: ${downloadUrl}`);
          
          console.log('\nTesting download URL...');
          try {
            const downloadResponse = await fetch(downloadUrl, { method: 'HEAD' });
            console.log(`  Status: ${downloadResponse.status} ${downloadResponse.statusText}`);
            console.log(`  Content-Type: ${downloadResponse.headers.get('content-type')}`);
          } catch (err) {
            console.log(`  Error: ${err}`);
          }
          
          // Test with proper Plex client headers (like a real player)
          console.log('\n--- Testing with Plex Client Headers ---');
          
          const plexHeaders = {
            'Accept': 'application/json',
            'X-Plex-Token': PLEX_TOKEN,
            'X-Plex-Client-Identifier': 'SchroStream-' + Date.now(),
            'X-Plex-Product': 'Plex Web',
            'X-Plex-Version': '4.0',
            'X-Plex-Platform': 'Chrome',
            'X-Plex-Platform-Version': '120.0',
            'X-Plex-Device': 'Linux',
            'X-Plex-Device-Name': 'SchroStream',
          };
          
          // Test playback decision endpoint (what real clients use)
          const decisionParams = new URLSearchParams({
            path: `/library/metadata/${ep.ratingKey}`,
            mediaIndex: '0',
            partIndex: '0',
            protocol: 'http',
            directPlay: '1',
            directStream: '1',
            directStreamAudio: '1',
            hasMDE: '1',
          });
          
          const decisionUrl = `${PLEX_URL}/video/:/transcode/universal/decision?${decisionParams.toString()}&X-Plex-Token=${PLEX_TOKEN}`;
          console.log(`Decision URL (proper): ${decisionUrl.substring(0, 120)}...`);
          
          try {
            const decisionResp = await fetch(decisionUrl, { headers: plexHeaders });
            console.log(`  Status: ${decisionResp.status} ${decisionResp.statusText}`);
            if (decisionResp.ok) {
              const data = await decisionResp.json();
              console.log('  mdeDecisionText:', data.MediaContainer?.mdeDecisionText);
              
              // Get the Media/Part from decision response
              const decMeta = data.MediaContainer?.Metadata?.[0];
              if (decMeta?.Media) {
                const decMedia = Array.isArray(decMeta.Media) ? decMeta.Media[0] : decMeta.Media;
                const decPart = Array.isArray(decMedia.Part) ? decMedia.Part[0] : decMedia.Part;
                
                console.log('\n  Decision Media info:');
                console.log('    selected:', decMedia.selected);
                console.log('    protocol:', decMedia.protocol);
                console.log('    Part key:', decPart?.key);
                console.log('    Part decision:', decPart?.decision);
                console.log('    Part stream:', decPart?.Stream);
                
                if (decPart?.key) {
                  // This is the actual streamable URL!
                  const actualStreamUrl = `${PLEX_URL}${decPart.key}?X-Plex-Token=${PLEX_TOKEN}`;
                  console.log(`\n  ACTUAL STREAM URL: ${actualStreamUrl}`);
                  
                  console.log('\n  Testing actual stream URL...');
                  try {
                    const streamResp = await fetch(actualStreamUrl, { 
                      method: 'HEAD',
                      headers: plexHeaders 
                    });
                    console.log(`    Status: ${streamResp.status} ${streamResp.statusText}`);
                    console.log(`    Content-Type: ${streamResp.headers.get('content-type')}`);
                    console.log(`    Content-Length: ${streamResp.headers.get('content-length')}`);
                  } catch (err) {
                    console.log(`    Error: ${err}`);
                  }
                }
              }
            }
          } catch (err) {
            console.log(`  Error: ${err}`);
          }
          
          // Try HLS streaming (what Plex web uses)
          const sessionId = `schrostream-${Date.now()}`;
          const hlsParams = new URLSearchParams({
            path: `/library/metadata/${ep.ratingKey}`,
            mediaIndex: '0',
            partIndex: '0',
            protocol: 'hls',
            session: sessionId,
            fastSeek: '1',
            directPlay: '0',
            directStream: '1',
            subtitleSize: '100',
            audioBoost: '100',
            location: 'lan',
            addDebugOverlay: '0',
            autoAdjustQuality: '0',
            directStreamAudio: '1',
            mediaBufferSize: '102400',
            subtitles: 'burn',
            'Accept-Language': 'en',
            'X-Plex-Session-Identifier': sessionId,
            'X-Plex-Client-Profile-Extra': 'add-transcode-target(type=videoProfile&context=streaming&protocol=hls&container=mpegts&videoCodec=h264&audioCodec=aac,ac3)',
          });
          
          const hlsUrl = `${PLEX_URL}/video/:/transcode/universal/start.m3u8?${hlsParams.toString()}&X-Plex-Token=${PLEX_TOKEN}`;
          console.log(`\nHLS URL: ${hlsUrl.substring(0, 120)}...`);
          
          try {
            const hlsResp = await fetch(hlsUrl, { headers: plexHeaders });
            console.log(`  Status: ${hlsResp.status} ${hlsResp.statusText}`);
            console.log(`  Content-Type: ${hlsResp.headers.get('content-type')}`);
            if (hlsResp.ok) {
              const m3u8 = await hlsResp.text();
              console.log(`  M3U8 content (first 500 chars):\n${m3u8.substring(0, 500)}`);
            }
          } catch (err) {
            console.log(`  Error: ${err}`);
          }
          
          // Try DASH streaming
          const dashParams = new URLSearchParams({
            path: `/library/metadata/${ep.ratingKey}`,
            mediaIndex: '0',
            partIndex: '0', 
            protocol: 'dash',
            session: sessionId,
            fastSeek: '1',
            directPlay: '0',
            directStream: '1',
          });
          
          const dashUrl = `${PLEX_URL}/video/:/transcode/universal/start.mpd?${dashParams.toString()}&X-Plex-Token=${PLEX_TOKEN}`;
          console.log(`\nDASH URL: ${dashUrl.substring(0, 120)}...`);
          
          try {
            const dashResp = await fetch(dashUrl, { headers: plexHeaders });
            console.log(`  Status: ${dashResp.status} ${dashResp.statusText}`);
          } catch (err) {
            console.log(`  Error: ${err}`);
          }
        }
      }
    }
  }

  console.log('\n' + '='.repeat(60));
  console.log('Test complete!');
}

main().catch(console.error);
