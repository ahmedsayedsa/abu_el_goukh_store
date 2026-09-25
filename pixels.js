/**
 * Abu El Goukh 1925 - Universal E-Commerce Pixels & Tracking Engine
 * Automatically connects Meta (Facebook/Instagram), TikTok, Snapchat, Google Analytics 4, Google Ads, and GTM
 * Configurations are loaded in real-time from Firebase Cloud DB (/pixels_settings.json)
 */
(function() {
    'use strict';

    const FIREBASE_DB = 'https://abu-el-goukh-store-default-rtdb.firebaseio.com/pixels_settings.json';
    let pixelConfig = null;
    let isInitialized = false;

    // Load Pixel settings from Cache or Firebase
    async function loadPixelConfig() {
        // Try local cache first for instant tracking
        try {
            const cached = localStorage.getItem('abu_pixels_settings');
            if (cached) {
                pixelConfig = JSON.parse(cached);
                initPixels(pixelConfig);
            }
        } catch(e) {}

        // Fetch live cloud configuration
        try {
            const res = await fetch(FIREBASE_DB);
            if (res.ok) {
                const live = await res.json();
                if (live && typeof live === 'object') {
                    pixelConfig = live;
                    localStorage.setItem('abu_pixels_settings', JSON.stringify(live));
                    if (!isInitialized) {
                        initPixels(live);
                    }
                }
            }
        } catch(e) {
            console.warn('[Pixels] Using cached pixel settings:', e);
        }
    }

    // Initialize all active tracking pixels
    function initPixels(cfg) {
        if (!cfg || isInitialized) return;
        isInitialized = true;

        // 1. Meta Pixel (Facebook & Instagram)
        if (cfg.meta && cfg.meta.enabled && cfg.meta.pixelId) {
            try {
                !function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?
                n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;
                n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;
                t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,
                document,'script','https://connect.facebook.net/en_US/fbevents.js');

                const metaOptions = {};
                if (cfg.meta.testEventCode) {
                    metaOptions.test_event_code = cfg.meta.testEventCode;
                }
                window.fbq('init', cfg.meta.pixelId.trim(), metaOptions);
                window.fbq('track', 'PageView');
                console.log('[Pixels] Meta Pixel initialized:', cfg.meta.pixelId);
            } catch(e) { console.error('[Pixels] Meta init error:', e); }
        }

        // 2. TikTok Pixel
        if (cfg.tiktok && cfg.tiktok.enabled && cfg.tiktok.pixelId) {
            try {
                !function (w, d, t) {
                    w.TiktokAnalyticsObject=t;var ttq=w[t]=w[t]||[];ttq.methods=["page","track","identify","instances","debug","on","off","once","ready","alias","group","enableCookie","disableCookie"];ttq.setAndDefer=function(t,e){t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}};for(var i=0;i<ttq.methods.length;i++)ttq.setAndDefer(ttq,ttq.methods[i]);ttq.instance=function(t){for(var e=ttq._i[t]||[],n=0;n<ttq.methods.length;n++)ttq.setAndDefer(e,ttq.methods[n]);return e};ttq.load=function(e,n){var i="https://analytics.tiktok.com/i18n/pixel/events.js";ttq._i=ttq._i||{},ttq._i[e]=[],ttq._i[e]._u=i,s=d.createElement("script");s.type="text/javascript",s.async=!0,s.src=i+"?sdkid="+e+"&lib="+t;var c=d.getElementsByTagName("script")[0];c.parentNode.insertBefore(s,c)};
                    ttq.load(cfg.tiktok.pixelId.trim());
                    ttq.page();
                }(window, document, 'ttq');
                console.log('[Pixels] TikTok Pixel initialized:', cfg.tiktok.pixelId);
            } catch(e) { console.error('[Pixels] TikTok init error:', e); }
        }

        // 3. Snapchat Pixel
        if (cfg.snapchat && cfg.snapchat.enabled && cfg.snapchat.pixelId) {
            try {
                (function(e,t,n){if(e.snaptr)return;var a=e.snaptr=function(){a.handleRequest?a.handleRequest.apply(a,arguments):a.queue.push(arguments)};
                a.queue=[];var s='script';var r=t.createElement(s);r.async=!0;
                r.src=n;var u=t.getElementsByTagName(s)[0];
                u.parentNode.insertBefore(r,u);})(window,document,'https://sc-static.net/scevent.min.js');

                window.snaptr('init', cfg.snapchat.pixelId.trim());
                window.snaptr('track', 'PAGE_VIEW');
                console.log('[Pixels] Snapchat Pixel initialized:', cfg.snapchat.pixelId);
            } catch(e) { console.error('[Pixels] Snapchat init error:', e); }
        }

        // 4. Google Tag (GA4 & Google Ads)
        if (cfg.google && cfg.google.enabled && (cfg.google.ga4Id || cfg.google.adsId)) {
            try {
                const primaryId = (cfg.google.ga4Id || cfg.google.adsId).trim();
                const script = document.createElement('script');
                script.async = true;
                script.src = `https://www.googletagmanager.com/gtag/js?id=${primaryId}`;
                document.head.appendChild(script);

                window.dataLayer = window.dataLayer || [];
                window.gtag = function() { window.dataLayer.push(arguments); };
                window.gtag('js', new Date());

                if (cfg.google.ga4Id) {
                    window.gtag('config', cfg.google.ga4Id.trim());
                }
                if (cfg.google.adsId) {
                    window.gtag('config', cfg.google.adsId.trim());
                }
                console.log('[Pixels] Google Tag initialized');
            } catch(e) { console.error('[Pixels] Google init error:', e); }
        }

        // 5. Google Tag Manager (GTM)
        if (cfg.gtm && cfg.gtm.enabled && cfg.gtm.containerId) {
            try {
                (function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':
                new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],
                j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src=
                'https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);
                })(window,document,'script','dataLayer',cfg.gtm.containerId.trim());
                console.log('[Pixels] GTM initialized:', cfg.gtm.containerId);
            } catch(e) { console.error('[Pixels] GTM init error:', e); }
        }

        // SECURITY FIX: Custom dynamic script execution disabled to prevent Stored XSS / Supply Chain attacks.
        // Tracking is strictly limited to verified official providers (Meta, TikTok, Snapchat, Google Tag, GTM).
    }

    // Universal E-Commerce Event Tracker
    window.trackStoreEvent = function(eventName, data) {
        data = data || {};
        const cfg = pixelConfig;
        if (!cfg) return;

        console.log(`[Pixels Event] ${eventName}:`, data);

        // ─── 1. ViewContent (Opening a product page) ───
        if (eventName === 'ViewContent') {
            const id = String(data.id || '');
            const name = data.name || '';
            const price = Number(data.price || 0);
            const category = data.category || 'دراجات';

            if (cfg.meta && cfg.meta.enabled && window.fbq) {
                window.fbq('track', 'ViewContent', {
                    content_name: name,
                    content_ids: [id],
                    content_type: 'product',
                    content_category: category,
                    value: price,
                    currency: 'EGP'
                });
            }
            if (cfg.tiktok && cfg.tiktok.enabled && window.ttq) {
                window.ttq.track('ViewContent', {
                    content_id: id,
                    content_type: 'product',
                    content_name: name,
                    content_category: category,
                    value: price,
                    currency: 'EGP'
                });
            }
            if (cfg.snapchat && cfg.snapchat.enabled && window.snaptr) {
                window.snaptr('track', 'VIEW_CONTENT', {
                    item_ids: [id],
                    item_category: category,
                    price: price,
                    currency: 'EGP'
                });
            }
            if (cfg.google && cfg.google.enabled && window.gtag) {
                window.gtag('event', 'view_item', {
                    currency: 'EGP',
                    value: price,
                    items: [{ item_id: id, item_name: name, price: price, item_category: category }]
                });
            }
        }

        // ─── 2. AddToCart (Adding a bike to cart) ───
        else if (eventName === 'AddToCart') {
            const id = String(data.id || '');
            const name = data.name || '';
            const price = Number(data.price || 0);

            if (cfg.meta && cfg.meta.enabled && window.fbq) {
                window.fbq('track', 'AddToCart', {
                    content_name: name,
                    content_ids: [id],
                    content_type: 'product',
                    value: price,
                    currency: 'EGP'
                });
            }
            if (cfg.tiktok && cfg.tiktok.enabled && window.ttq) {
                window.ttq.track('AddToCart', {
                    content_id: id,
                    content_type: 'product',
                    content_name: name,
                    value: price,
                    currency: 'EGP'
                });
            }
            if (cfg.snapchat && cfg.snapchat.enabled && window.snaptr) {
                window.snaptr('track', 'ADD_CART', {
                    item_ids: [id],
                    price: price,
                    currency: 'EGP'
                });
            }
            if (cfg.google && cfg.google.enabled && window.gtag) {
                window.gtag('event', 'add_to_cart', {
                    currency: 'EGP',
                    value: price,
                    items: [{ item_id: id, item_name: name, price: price }]
                });
            }
        }

        // ─── 3. InitiateCheckout (Customer is at checkout) ───
        else if (eventName === 'InitiateCheckout') {
            const total = Number(data.total || data.value || 0);
            const numItems = Number(data.itemsCount || 1);

            if (cfg.meta && cfg.meta.enabled && window.fbq) {
                window.fbq('track', 'InitiateCheckout', {
                    num_items: numItems,
                    value: total,
                    currency: 'EGP'
                });
            }
            if (cfg.tiktok && cfg.tiktok.enabled && window.ttq) {
                window.ttq.track('InitiateCheckout', {
                    value: total,
                    currency: 'EGP'
                });
            }
            if (cfg.snapchat && cfg.snapchat.enabled && window.snaptr) {
                window.snaptr('track', 'START_CHECKOUT', {
                    price: total,
                    currency: 'EGP'
                });
            }
            if (cfg.google && cfg.google.enabled && window.gtag) {
                window.gtag('event', 'begin_checkout', {
                    currency: 'EGP',
                    value: total
                });
            }
        }

        // ─── 4. Purchase (Order confirmed or paid) ───
        else if (eventName === 'Purchase') {
            const orderId = String(data.orderId || data.id || 'AEG-ORDER');
            const total = Number(data.total || data.value || 0);
            const items = Array.isArray(data.items) ? data.items : [];
            const itemIds = items.map(i => String(i.id || ''));

            if (cfg.meta && cfg.meta.enabled && window.fbq) {
                window.fbq('track', 'Purchase', {
                    content_type: 'product',
                    content_ids: itemIds,
                    value: total,
                    currency: 'EGP',
                    order_id: orderId
                });
            }
            if (cfg.tiktok && cfg.tiktok.enabled && window.ttq) {
                window.ttq.track('PlaceAnOrder', {
                    value: total,
                    currency: 'EGP',
                    order_id: orderId
                });
                window.ttq.track('CompletePayment', {
                    value: total,
                    currency: 'EGP',
                    order_id: orderId
                });
            }
            if (cfg.snapchat && cfg.snapchat.enabled && window.snaptr) {
                window.snaptr('track', 'PURCHASE', {
                    price: total,
                    currency: 'EGP',
                    transaction_id: orderId
                });
            }
            if (cfg.google && cfg.google.enabled && window.gtag) {
                window.gtag('event', 'purchase', {
                    transaction_id: orderId,
                    value: total,
                    currency: 'EGP',
                    items: items.map(it => ({ item_id: String(it.id || ''), item_name: it.name || '', price: Number(it.price || 0) }))
                });

                // Google Ads Conversion tracking if label configured
                if (cfg.google.adsId && cfg.google.adsPurchaseLabel) {
                    window.gtag('event', 'conversion', {
                        send_to: `${cfg.google.adsId.trim()}/${cfg.google.adsPurchaseLabel.trim()}`,
                        value: total,
                        currency: 'EGP',
                        transaction_id: orderId
                    });
                }
            }
        }
    };

    // Auto-init on script load
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', loadPixelConfig);
    } else {
        loadPixelConfig();
    }
})();
