#!/usr/bin/env python3
"""Google Search Console & Bing Webmaster Tools Setup for QNFO domains.

CREDENTIAL DISCOVERY (auto):
- CLOUDFLARE_API_TOKEN from keys.json or env var

Prints step-by-step instructions for registering all QNFO domains
in Google Search Console and Bing Webmaster Tools.
"""

SITEMAP_URLS = {
    "rwnq8.github.io": "https://rwnq8.github.io/sitemap.xml",
    "qnfo-landing.pages.dev": "https://qnfo-landing.pages.dev/sitemap.xml",
}

CLOUDFLARE_ZONES = [
    "qnfo.org", "qwav.org", "qwav.tech", "qwav.net", "qwav.uk",
    "qwave.tech", "qnfo.net", "qnfo.uk", "q-wave.tech",
    "ipatent.me", "q08.org", "empoweringchange.today",
]

def main():
    print("=" * 60)
    print("GOOGLE SEARCH CONSOLE & BING WEBMASTER TOOLS SETUP")
    print("=" * 60)
    print("\n## STEP 1: Google Search Console - Add Properties")
    print("\nGo to: https://search.google.com/search-console/welcome")
    print("\n### Domain Properties (covers ALL subdomains):")
    for zone in CLOUDFLARE_ZONES:
        print(f"   {zone}")
    print("\n### URL-Prefix Properties:")
    for domain in SITEMAP_URLS:
        print(f"   {domain}")
    print("\n## STEP 2: Verification (Cloudflare auto-verify)")
    print("\nGoogle detects Cloudflare as DNS provider and auto-adds the TXT record.")
    print("\n## STEP 3: Submit Sitemaps")
    for domain, url in SITEMAP_URLS.items():
        print(f"\n   {domain}:")
        print(f"     Sitemap URL: {url}")
    print("\n## STEP 4: Bing Webmaster Tools")
    print("\n   1. https://www.bing.com/webmasters/home")
    print("   2. Sign in, 'Add a site' for each domain")
    print("   3. Import from Google Search Console (easiest)")
    print("\n## STEP 5: Robots.txt Verification")
    for domain in SITEMAP_URLS:
        print(f"   https://{domain}/robots.txt")
    print("\n" + "=" * 60)
    print("PRIORITY: qnfo.org -> qwav.org -> rwnq8.github.io")
    print("=" * 60)

if __name__ == '__main__':
    main()
