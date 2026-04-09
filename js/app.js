(function () {
  'use strict';

  const MAX_VIEW_LATITUDE = 84.8;
  const FAVORITES_KEY = 'worldmap:favorites:v1';
  const DEFAULT_STYLE = 'satellite';
  const HOME_VIEW = {
    lon: 127.5,
    lat: 36.0,
    alt: 18000000,
    heading: 0,
    pitch: -90,
    roll: 0,
  };

  window.CESIUM_BASE_URL = 'https://cdn.jsdelivr.net/npm/cesium@1.95.0/Build/Cesium/';

  function boot() {
    Cesium.Ion.defaultAccessToken = undefined;

    const creditSink = document.createElement('div');
    creditSink.style.display = 'none';
    document.body.appendChild(creditSink);

    const viewer = createViewer(creditSink);
    const scene = viewer.scene;
    const baseLayer = viewer.imageryLayers.get(0);
    const styleManager = createStyleManager(viewer, baseLayer);
    const overlays = createOverlayLayers(viewer);
    const koreaSubwayOverlay = createKoreaSubwayOverlay(viewer);
    styleManager.attachOverlays(overlays);
    styleManager.attachKoreaSubwayOverlay(koreaSubwayOverlay);

    configureScene(viewer);

    const sharedState = {
      currentStyle: DEFAULT_STYLE,
      lastSearchResult: null,
      lastPointerCartesian: null,
      lastPointerPosition: null,
      shareToastTimer: null,
    };

    const isMobileInit = window.matchMedia('(max-width: 768px)').matches;
    const initialView = isMobileInit ? null : readViewFromHash(); // 모바일: 항상 HOME_VIEW
    if (initialView) {
      viewer.camera.setView({
        destination: Cesium.Cartesian3.fromDegrees(initialView.lon, initialView.lat, initialView.alt),
        orientation: {
          heading: Cesium.Math.toRadians(initialView.heading || 0),
          pitch: Cesium.Math.toRadians(initialView.pitch || -90),
          roll: 0,
        },
      });
      if (initialView.style) {
        sharedState.currentStyle = initialView.style;
      }
    } else {
      viewer.camera.setView({
        destination: Cesium.Cartesian3.fromDegrees(HOME_VIEW.lon, HOME_VIEW.lat, HOME_VIEW.alt),
        orientation: {
          heading: Cesium.Math.toRadians(HOME_VIEW.heading),
          pitch: Cesium.Math.toRadians(HOME_VIEW.pitch),
          roll: HOME_VIEW.roll,
        },
      });
    }

    styleManager.setStyle(sharedState.currentStyle);

    wireLoading(scene);
    wireInfoBar(viewer, sharedState);
    wireHomeButton(viewer, sharedState);
    wireSearch(viewer, sharedState);
    wireShare(viewer, sharedState, styleManager);
    wireCurrentLocation(viewer, sharedState);
    wirePanelExclusivity();
    wireStylePicker(viewer, styleManager, sharedState);
    wireMiniMap(viewer);
    wireFavorites(viewer, sharedState);
    wireMobileGestures(viewer);

    scene.requestRender();
  }

  function createViewer(creditSink) {
    const commonOptions = {
      terrainProvider: new Cesium.EllipsoidTerrainProvider(),
      baseLayerPicker: false,
      geocoder: false,
      homeButton: false,
      sceneModePicker: false,
      navigationHelpButton: false,
      animation: false,
      timeline: false,
      fullscreenButton: false,
      infoBox: false,
      selectionIndicator: false,
      creditContainer: creditSink,
      requestRenderMode: true,
      maximumRenderTimeChange: Infinity,
    };
    try {
      // UrlTemplateImageryProvider: 메타데이터 요청 없이 즉시 타일 로드 시작 (무한로딩 방지)
      return new Cesium.Viewer('cesiumContainer', {
        ...commonOptions,
        imageryProvider: new Cesium.UrlTemplateImageryProvider({
          url: 'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
          maximumLevel: 19,
          credit: 'Esri, Maxar, Earthstar Geographics',
        }),
      });
    } catch (error) {
      console.warn('primary imagery provider failed, using fallback:', error);
      return new Cesium.Viewer('cesiumContainer', {
        ...commonOptions,
        imageryProvider: new Cesium.UrlTemplateImageryProvider({
          url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
          maximumLevel: 19,
          credit: 'OpenStreetMap contributors',
        }),
      });
    }
  }

  function createOverlayLayers(viewer) {
    const overlays = {
      arcgisLabels: viewer.imageryLayers.addImageryProvider(new Cesium.UrlTemplateImageryProvider({
        url: 'https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',
        maximumLevel: 19,
      })),
      cartoLightLabels: viewer.imageryLayers.addImageryProvider(new Cesium.UrlTemplateImageryProvider({
        url: 'https://basemaps.cartocdn.com/light_only_labels/{z}/{x}/{y}.png',
        maximumLevel: 20,
        credit: 'CARTO / OpenStreetMap',
      })),
      arcgisOverlay: viewer.imageryLayers.addImageryProvider(new Cesium.UrlTemplateImageryProvider({
        url: 'https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Reference_Overlay/MapServer/tile/{z}/{y}/{x}',
        maximumLevel: 19,
      })),
      railOverlay: viewer.imageryLayers.addImageryProvider(new Cesium.UrlTemplateImageryProvider({
        url: 'https://tiles.openrailwaymap.org/standard/{z}/{x}/{y}.png',
        maximumLevel: 18,
        credit: 'OpenRailwayMap / OpenStreetMap',
      })),
    };

    overlays.arcgisLabels.alpha = 1.0;
    overlays.cartoLightLabels.alpha = 0.65;
    overlays.arcgisOverlay.alpha = 0.95;
    overlays.railOverlay.alpha = 0;
    overlays.railOverlay.show = false;
    return overlays;
  }

  function createStyleManager(viewer, initialBaseLayer) {
    let overlays = null;
    let koreaSubwayOverlay = null;

    const baseLayers = {
      satellite: initialBaseLayer,
      roadmap: viewer.imageryLayers.addImageryProvider(new Cesium.UrlTemplateImageryProvider({
        url: 'https://basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}.png',
        maximumLevel: 20,
        credit: 'CARTO / OpenStreetMap contributors',
      }), 0),
      terrain: viewer.imageryLayers.addImageryProvider(new Cesium.ArcGisMapServerImageryProvider({
        url: 'https://services.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer',
        enablePickFeatures: false,
      }), 0),
    };

    Object.entries(baseLayers).forEach(([key, layer]) => {
      layer.show = key === DEFAULT_STYLE;
      layer.alpha = key === DEFAULT_STYLE ? 1 : 0;
    });

    function applyBaseLayerTuning(style) {
      Object.values(baseLayers).forEach(layer => {
        layer.brightness = 1.0;
        layer.contrast = 1.0;
        layer.gamma = 1.0;
        layer.saturation = 1.0;
      });
      const active = baseLayers[style];
      if (!active) return;
      if (style === 'satellite') {
        active.brightness = 1.03;
        active.contrast = 1.1;
        active.gamma = 0.96;
        active.saturation = 1.04;
      } else if (style === 'terrain') {
        active.brightness = 1.02;
        active.contrast = 1.06;
        active.gamma = 0.99;
        active.saturation = 1.02;
      }
    }

    function syncOverlayVisibility(style) {
      if (!overlays) return;
      const isSatellite = style === 'satellite';
      overlays.arcgisLabels.show = isSatellite;
      overlays.arcgisLabels.alpha = isSatellite ? 0.92 : 0;
      overlays.arcgisOverlay.show = isSatellite;
      overlays.arcgisOverlay.alpha = isSatellite ? 0.95 : 0;
      const isRoadmap = style === 'roadmap';
      overlays.cartoLightLabels.show = isRoadmap;
      overlays.cartoLightLabels.alpha = isRoadmap ? 0.82 : 0;
      overlays.railOverlay.show = false;
      overlays.railOverlay.alpha = 0;
      // 일반 지도: 지하철 표시 / 위성 등 다른 스타일: 지하철 숨김
      if (koreaSubwayOverlay) koreaSubwayOverlay.setVisible(style === 'roadmap');
      viewer.scene.requestRender();
    }

    const manager = {
      attachOverlays(value) {
        overlays = value;
        syncOverlayVisibility(DEFAULT_STYLE);
      },
      attachKoreaSubwayOverlay(value) {
        koreaSubwayOverlay = value;
        syncOverlayVisibility(DEFAULT_STYLE);
      },
      wireProviderRecovery() {
        const fallbackToSatellite = () => {
          Object.entries(baseLayers).forEach(([name, layer]) => {
            const active = name === 'satellite';
            layer.show = active;
            layer.alpha = active ? 1 : 0;
          });
          applyBaseLayerTuning('satellite');
          if (koreaSubwayOverlay) koreaSubwayOverlay.setVisible(false);
          viewer.scene.requestRender();
        };
        ['roadmap', 'terrain'].forEach((name) => {
          const provider = baseLayers[name] && baseLayers[name].imageryProvider;
          if (provider && provider.errorEvent && typeof provider.errorEvent.addEventListener === 'function') {
            provider.errorEvent.addEventListener((error) => {
              console.warn(name + ' imagery provider error:', error);
              if (baseLayers[name].show) fallbackToSatellite();
            });
          }
        });
      },
      setStyle(style) {
        const key = baseLayers[style] ? style : DEFAULT_STYLE;
        Object.entries(baseLayers).forEach(([name, layer]) => {
          const active = name === key;
          layer.show = active;
          layer.alpha = active ? 1 : 0;
        });
        applyBaseLayerTuning(key);
        syncOverlayVisibility(key);
        return key;
      },
    };
    manager.wireProviderRecovery();
    return manager;
  }


  function createCloudLayer(viewer) {
    const earthRadius = 6378137.0;
    const cloudScale = 1.012;
    const cloudAlphaBase = 0.78;
    const cloudEntity = viewer.entities.add({
      name: 'animated-cloud-layer',
      position: Cesium.Cartesian3.ZERO,
      orientation: new Cesium.CallbackProperty(() => {
        const seconds = Date.now() / 1000;
        const heading = Cesium.Math.toRadians((seconds * 0.65) % 360);
        return Cesium.Transforms.headingPitchRollQuaternion(
          Cesium.Cartesian3.ZERO,
          new Cesium.HeadingPitchRoll(heading, 0, 0)
        );
      }, false),
      ellipsoid: {
        radii: new Cesium.Cartesian3(earthRadius * cloudScale, earthRadius * cloudScale, earthRadius * cloudScale),
        material: new Cesium.ImageMaterialProperty({
          image: 'clouds_overlay.png',
          transparent: true,
          color: new Cesium.CallbackProperty(() => {
            const height = (viewer && viewer.camera && viewer.camera.positionCartographic && viewer.camera.positionCartographic.height) || 0;
            const alpha = height < 1500000 ? 0.34 : height < 5000000 ? 0.52 : cloudAlphaBase;
            return Cesium.Color.WHITE.withAlpha(alpha);
          }, false),
        }),
        outline: false,
        subdivisions: 128,
        stackPartitions: 128,
        slicePartitions: 128,
      },
    });
    cloudEntity.show = true;
    if (viewer.scene && viewer.scene.postRender) {
      viewer.scene.postRender.addEventListener(() => viewer.scene.requestRender());
    }
    return cloudEntity;
  }

  function createKoreaSubwayOverlay(viewer) {
    const DATA_URL = 'https://overpass-api.de/api/interpreter';
    const CACHE_KEYS = ['worldmap:korea-subway-overlay:v34', 'worldmap:korea-subway-overlay:v33', 'worldmap:korea-subway-overlay:v28', 'worldmap:korea-subway-overlay:v27', 'worldmap:korea-subway-overlay:v25', 'worldmap:korea-subway-overlay:v24', 'worldmap:korea-subway-overlay:v2'];
    const CACHE_TTL = 1000 * 60 * 60 * 24 * 14;
    const dataSource = new Cesium.CustomDataSource('korea-subway-overlay');
    dataSource.show = false;
    viewer.dataSources.add(dataSource);
    window.KR_SUBWAY_OVERLAY_DATA = window.KR_SUBWAY_OVERLAY_DATA || null;

    const lineColorMap = {
      '1호선': '#0D3692', '2호선': '#33A23D', '3호선': '#FE5B10', '4호선': '#32A1C8',
      '5호선': '#8B50A4', '6호선': '#C55C1D', '7호선': '#54640D', '8호선': '#F14C82',
      '9호선': '#BDB092', '공항철도': '#0090D2', '공항철도선': '#0090D2', '신분당선': '#D31145',
      '수인분당선': '#F5A200', '수인·분당선': '#F5A200', '경의중앙선': '#77C4A3', '경춘선': '#0C8E72',
      '서해선': '#8FC31F', '신림선': '#6789CA', '우이신설선': '#B7C452', '김포골드라인': '#A17800',
      '의정부경전철': '#FDA600', '에버라인': '#6FB245', '인천1호선': '#7CA8D5', '인천2호선': '#ED8B00',
      '부산1호선': '#F06A00', '부산2호선': '#81BF48', '부산3호선': '#BB8C00', '부산4호선': '#2D9EDB',
      '동해선': '#0054A6', '대구1호선': '#D93F5C', '대구2호선': '#00A84D', '대구3호선': '#F4A116',
      '대전1호선': '#007448', '광주1호선': '#0090D2', 'GTX-A': '#9B6B43'
    };

    function resolveColor(tags = {}) {
      const candidates = [tags.colour, tags.color, tags['line:colour'], tags.ref, tags.name, tags.route];
      for (const value of candidates) {
        if (!value) continue;
        const items = String(value).split(/[\/,|]/).map(v => v.trim()).filter(Boolean);
        for (const item of items) {
          if (/^#?[0-9a-fA-F]{6}$/.test(item)) return item.startsWith('#') ? item : '#' + item;
          if (lineColorMap[item]) return lineColorMap[item];
          const compact = item.replace(/\s+/g, '');
          if (lineColorMap[compact]) return lineColorMap[compact];
        }
      }
      return '#4B8BFF';
    }

    function resolveLineName(tags = {}) {
      return tags['name:ko'] || tags.name || tags.ref || tags.line || tags.route || '지하철';
    }

    function normalizeLineName(name = '') {
      return String(name || '').replace(/\s+/g, ' ').trim();
    }

    function isExcludedUrbanRail(tags = {}) {
      const text = [
        tags['name:ko'], tags.name, tags.ref, tags.network, tags.operator, tags.brand, tags.description
      ].filter(Boolean).join(' ');
      return /(월미바다열차|월미은하레일|자기부상열차|관광열차|관광\s*모노레일|케이블카|삭도)/i.test(text);
    }

    function parseCached() {
      try {
        let best = null;
        CACHE_KEYS.forEach((cacheKey) => {
          const raw = localStorage.getItem(cacheKey);
          if (!raw) return;
          const cached = JSON.parse(raw);
          if (!cached || !cached.timestamp || !cached.data) return;
          if (!best || cached.timestamp > best.timestamp) best = cached;
        });
        if (!best) return null;
        return { data: best.data, expired: Date.now() - best.timestamp > CACHE_TTL, timestamp: best.timestamp };
      } catch (error) {
        console.warn('subway cache parse failed', error);
        return null;
      }
    }

    function storeCache(data) {
      try {
        const payload = JSON.stringify({ timestamp: Date.now(), data });
        CACHE_KEYS.forEach((cacheKey) => {
          localStorage.setItem(cacheKey, payload);
        });
        window.KR_SUBWAY_OVERLAY_DATA = data;
      } catch (error) {
        console.warn('subway cache store failed', error);
      }
    }

    // 병합 비교용 키: 괄호 제거 + 역 제거
    function getStationLabelKey(name = '') {
      return String(name).trim()
        .replace(/\s*[\(（][^\)）]*[\)）]/g, '')
        .replace(/역$/, '')
        .replace(/\s+/g, ' ')
        .trim();
    }

    // 표시용 이름: 괄호 제거 + 역 suffix 보장
    function normalizeStationDisplayName(name = '') {
      const cleaned = String(name).trim()
        .replace(/\s*[\(（][^\)）]*[\)）]/g, '')
        .replace(/역$/, '')
        .replace(/\s+/g, ' ')
        .trim();
      return cleaned ? cleaned + '역' : '';
    }

    function getStationDistanceMeters(a, b) {
      const avgLat = (((a && a.lat) || 0) + ((b && b.lat) || 0)) / 2;
      const latScale = 111320;
      const lonScale = Math.cos(Cesium.Math.toRadians(avgLat)) * 111320;
      const dx = (((a && a.lon) || 0) - ((b && b.lon) || 0)) * lonScale;
      const dy = (((a && a.lat) || 0) - ((b && b.lat) || 0)) * latScale;
      return Math.sqrt(dx * dx + dy * dy);
    }

    // 노선 색상 점 canvas 생성 (각 노선 색상 원)
    function makeLineDotsCanvas(lines) {
      try {
        const dotR = 5;
        const gap = 3;
        const n = lines.length;
        const w = n * (dotR * 2) + Math.max(0, n - 1) * gap;
        const h = dotR * 2;
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(w, 1);
        canvas.height = Math.max(h, 1);
        const ctx = canvas.getContext('2d');
        if (!ctx) return null;
        lines.forEach((l, i) => {
          const cx = i * (dotR * 2 + gap) + dotR;
          ctx.beginPath();
          ctx.arc(cx, dotR, dotR - 0.75, 0, Math.PI * 2);
          ctx.fillStyle = l.color || '#ffffff';
          ctx.fill();
          ctx.strokeStyle = '#0f172a';
          ctx.lineWidth = 1.5;
          ctx.stroke();
        });
        return canvas;
      } catch (e) {
        console.warn('makeLineDotsCanvas failed:', e);
        return null;
      }
    }

    // canvas 캐시: 동일 색상 조합은 재사용 (매번 DOM 생성 방지)
    const dotsCanvasCache = new Map();

    function makeLineDotsCanvasCached(lines) {
      const key = lines.map(l => (l.color || '#4B8BFF').toLowerCase()).join('|');
      if (dotsCanvasCache.has(key)) return dotsCanvasCache.get(key);
      const canvas = makeLineDotsCanvas(lines);
      if (canvas) dotsCanvasCache.set(key, canvas);
      return canvas;
    }

    function addEntities(dataset) {
      if (!dataset) return;
      // 새 데이터 로드 시 canvas 캐시 초기화
      dotsCanvasCache.clear();
      // suspendEvents: 수백 개 entity add를 배치 처리 — 내부 update 1회로 압축
      dataSource.entities.suspendEvents();
      try {
        dataSource.entities.removeAll();

        (dataset.lines || []).forEach((line) => {
          if (!Array.isArray(line.positions) || line.positions.length < 2) return;
          dataSource.entities.add({
            polyline: {
              positions: Cesium.Cartesian3.fromDegreesArray(line.positions.flat()),
              width: 4.2,
              material: Cesium.Color.fromCssColorString(line.color || '#4B8BFF').withAlpha(0.92),
              clampToGround: true,
            },
            properties: { kind: 'subway-line', name: line.name || '지하철' },
          });
        });

        // ── 역 병합: 이름 + 근접도 기준 ──────────────────────────────
        const mergedStations = [];
        (dataset.stations || []).forEach((station) => {
          if (!Number.isFinite(station.lon) || !Number.isFinite(station.lat)) return;
          const labelKey = getStationLabelKey(station.name);
          if (!labelKey) return;

          const existing = mergedStations.find((item) => {
            if (item.key !== labelKey) return false;
            const dist = getStationDistanceMeters(item, station);
            return dist <= 400;
          });

          if (existing) {
            existing.lon = (existing.lon + station.lon) / 2;
            existing.lat = (existing.lat + station.lat) / 2;
            existing.displayName = normalizeStationDisplayName(existing.name);
            if (station.line && station.color && station.color !== '#ffffff' && station.color !== '#4B8BFF') {
              const dup = existing.lines.some(
                l => l.line === station.line || l.color.toLowerCase() === station.color.toLowerCase()
              );
              if (!dup) existing.lines.push({ line: station.line, color: station.color });
            }
          } else {
            const firstLines = (station.line && station.color && station.color !== '#ffffff' && station.color !== '#4B8BFF')
              ? [{ line: station.line, color: station.color }]
              : [];
            mergedStations.push({
              key: labelKey,
              name: station.name || '',
              displayName: normalizeStationDisplayName(station.name),
              lon: station.lon,
              lat: station.lat,
              lines: firstLines,
            });
          }
        });

        // ── lines 배열 최종 정리: 색상 기준 중복 제거 ──
        mergedStations.forEach((s) => {
          const seenColors = new Set();
          s.lines = s.lines.filter((l) => {
            const key = (l.color || '').toLowerCase();
            if (seenColors.has(key)) return false;
            seenColors.add(key);
            return true;
          });
        });

        // ── mergedStations 자체 중복 제거 ──
        for (let i = mergedStations.length - 1; i >= 0; i--) {
          for (let j = 0; j < i; j++) {
            const a = mergedStations[j], b = mergedStations[i];
            if (a.key === b.key && getStationDistanceMeters(a, b) <= 400) {
              b.lines.forEach((l) => {
                const dup = a.lines.some((al) => al.color.toLowerCase() === l.color.toLowerCase());
                if (!dup) a.lines.push(l);
              });
              mergedStations.splice(i, 1);
              break;
            }
          }
        }

        if (window.WorldSearch && typeof window.WorldSearch.registerSubwayStations === 'function') {
          window.WorldSearch.registerSubwayStations(mergedStations.map((s) => ({
            ...s,
            name: s.displayName || normalizeStationDisplayName(s.name) || s.name,
            line: (s.lines[0] || {}).line || '',
            color: (s.lines[0] || {}).color || '#4B8BFF',
            zoom: 12,
            countryKo: '대한민국',
            countryEn: 'Korea',
            countryCode: 'KR',
          })));
        }

        // ── 렌더링 ────────────────────────────────────────────────────
        mergedStations.forEach((station) => {
          const seenRenderColors = new Set();
          const dedupedLines = (station.lines.length > 0 ? station.lines : [{ line: '', color: '#4B8BFF' }])
            .filter((l) => {
              const k = (l.color || '#4B8BFF').toLowerCase().replace(/\s+/g, '');
              if (seenRenderColors.has(k)) return false;
              seenRenderColors.add(k);
              return true;
            });

          const dotsCanvas = makeLineDotsCanvasCached(dedupedLines);

          dataSource.entities.add({
            position: Cesium.Cartesian3.fromDegrees(station.lon, station.lat),
            label: {
              text: station.displayName || normalizeStationDisplayName(station.name) || '',
              font: '12px sans-serif',
              style: Cesium.LabelStyle.FILL_AND_OUTLINE,
              fillColor: Cesium.Color.WHITE,
              outlineColor: Cesium.Color.fromCssColorString('#0f172a'),
              outlineWidth: 3,
              verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
              horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
              pixelOffset: new Cesium.Cartesian2(0, -22),
              heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
              disableDepthTestDistance: Number.POSITIVE_INFINITY,
              scaleByDistance: new Cesium.NearFarScalar(12000, 1.0, 4000000, 0.62),
              translucencyByDistance: new Cesium.NearFarScalar(15000, 1.0, 6500000, 0.18),
            },
            properties: { kind: 'subway-station', name: station.name || '', line: dedupedLines.map(l => l.line).join(',') },
          });
          if (!dotsCanvas) return;
          dataSource.entities.add({
            position: Cesium.Cartesian3.fromDegrees(station.lon, station.lat),
            billboard: {
              image: dotsCanvas,
              verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
              horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
              pixelOffset: new Cesium.Cartesian2(0, -10),
              heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
              disableDepthTestDistance: Number.POSITIVE_INFINITY,
              scaleByDistance: new Cesium.NearFarScalar(12000, 1.0, 2500000, 0.62),
              translucencyByDistance: new Cesium.NearFarScalar(15000, 1.0, 4000000, 0.15),
            },
          });
        });
      } finally {
        // resumeEvents: 모든 add 완료 후 Cesium 내부 update 1회 발생
        dataSource.entities.resumeEvents();
      }
      viewer.scene.requestRender();
    }

    function isUrbanRailRelation(tags = {}) {
      const route = String(tags.route || '').toLowerCase();
      if (route === 'subway' || route === 'light_rail' || route === 'monorail') return true;
      if (route !== 'train') return false;
      const text = [tags.name, tags.ref, tags.network, tags.operator].filter(Boolean).join(' ');
      // 명확한 장거리 국가철도 키워드만 제외 (lookahead 없이)
      if (/\bKTX\b|\bITX\b|무궁화호|새마을호|누리로|경부고속선|호남고속선|경전선|장항선|충북선|태백선|영동선|정선선/i.test(text)) return false;
      // 도시철도·수도권 전철 포함
      return /(호선|공항철도|신분당|수인|분당|경의중앙|경춘|서해|신림|우이|김포|의정부|에버라인|인천[12]호선|부산[1-4]호선|대구[123]호선|대전[1]호선|광주[1]호선|GTX|도시철도|수도권 전철)/i.test(text);
    }

    function roleLooksLikeStation(role = '') {
      return /(stop|station|platform|halt|stop_entry_only|stop_exit_only)/i.test(String(role || ''));
    }

    function nodeLooksLikeStation(tags = {}) {
      if (isExcludedUrbanRail(tags)) return false;
      const railway = String(tags.railway || '').toLowerCase();
      const publicTransport = String(tags.public_transport || '').toLowerCase();
      const station = String(tags.station || '').toLowerCase();
      const text = [tags['name:ko'], tags.name, tags.network, tags.operator, tags.line, tags.ref].filter(Boolean).join(' ');
      return !!((tags['name:ko'] || tags.name) && (
        station === 'subway' || station === 'light_rail' || station === 'monorail' ||
        railway === 'station' || railway === 'halt' || railway === 'platform' ||
        publicTransport === 'station' || publicTransport === 'platform' || publicTransport === 'stop_position' ||
        /(공항철도|신분당|수인|분당|경의|중앙|경춘|서해|신림|우이|김포|의정부|에버|인천|부산|대구|대전|광주|동해|GTX|도시철도|수도권 전철|지하철)/i.test(text)
      ));
    }

    function relationText(tags = {}) {
      return [tags.name, tags.ref, tags.network, tags.operator].filter(Boolean).join(' ');
    }

    function centerFromGeometry(geometry) {
      if (!Array.isArray(geometry) || !geometry.length) return null;
      let minLat = Infinity, maxLat = -Infinity, minLon = Infinity, maxLon = -Infinity;
      geometry.forEach((pos) => {
        if (!Number.isFinite(pos.lat) || !Number.isFinite(pos.lon)) return;
        minLat = Math.min(minLat, pos.lat); maxLat = Math.max(maxLat, pos.lat);
        minLon = Math.min(minLon, pos.lon); maxLon = Math.max(maxLon, pos.lon);
      });
      if (!Number.isFinite(minLat) || !Number.isFinite(minLon)) return null;
      return { lat: (minLat + maxLat) / 2, lon: (minLon + maxLon) / 2 };
    }

    function addStationFromMember(stations, stationSeen, stationSeenByLoc, source, lineName, color) {
      if (!source) return;
      const tags = source.tags || {};
      const name = tags['name:ko'] || tags.name || tags.official_name || '';
      const point = Number.isFinite(source.lon) && Number.isFinite(source.lat)
        ? { lon: source.lon, lat: source.lat }
        : centerFromGeometry(source.geometry);
      if (!name || !point) return;
      const resolvedLine = lineName || tags.line || tags.ref || '';
      // 위치+이름 기준 전역 중복 방지 (노선명은 dedup key에서 제외 → 방향별 중복 relation 처리 시 같은 역 2번 추가 방지)
      const dedupeKey = name + ':' + point.lon.toFixed(4) + ':' + point.lat.toFixed(4);
      if (stationSeen.has(dedupeKey)) return;
      stationSeen.add(dedupeKey);
      // 이름 기준 중복 방지
      const locKey = name.replace(/역$/, '').trim();
      stationSeenByLoc.add(locKey);
      stations.push({ name, lon: point.lon, lat: point.lat, line: resolvedLine, color: color || resolveColor(tags) });
    }

    function transformOverpass(raw) {
      const elements = Array.isArray(raw && raw.elements) ? raw.elements : [];
      const nodeMap = new Map();
      const wayMap = new Map();
      const relationMap = new Map();
      elements.forEach((el) => {
        if (el.type === 'node') nodeMap.set(el.id, el);
        if (el.type === 'way') wayMap.set(el.id, el);
        if (el.type === 'relation') relationMap.set(el.id, el);
      });

      const selectedRelations = [];
      relationMap.forEach((relation) => {
        const tags = relation.tags || {};
        if (isUrbanRailRelation(tags)) selectedRelations.push(relation);
      });

      const lines = [];
      const stations = [];
      const stationSeen = new Set();       // name:line:lon:lat — 노선별 중복 방지
      const stationSeenByLoc = new Set();  // name:lon:lat — 위치 기준 중복 방지
      const selectedMemberNodeIds = new Set();

      selectedRelations.forEach((relation) => {
        const tags = relation.tags || {};
        if (isExcludedUrbanRail(tags)) return;
        const members = Array.isArray(relation.members) ? relation.members : [];
        const color = resolveColor(tags);
        const name = normalizeLineName(resolveLineName(tags) || relationText(tags) || '지하철');
        const segmentSeen = new Set();

        // 1패스: 역 먼저 수집
        const relationStations = [];
        members.forEach((member) => {
          if (member.type === 'node') {
            selectedMemberNodeIds.add(member.ref);
            const node = nodeMap.get(member.ref);
            if (node && (roleLooksLikeStation(member.role) || nodeLooksLikeStation(node.tags || {}))) {
              addStationFromMember(stations, stationSeen, stationSeenByLoc, node, name, color);
              if (Number.isFinite(node.lon) && Number.isFinite(node.lat)) {
                relationStations.push({ lon: node.lon, lat: node.lat });
              }
            }
          } else if (member.type === 'way') {
            const way = wayMap.get(member.ref);
            if (roleLooksLikeStation(member.role) && way) {
              addStationFromMember(stations, stationSeen, stationSeenByLoc, way, name, color);
              const c = centerFromGeometry(way.geometry);
              if (c) relationStations.push(c);
            }
          }
        });

        // 2패스: way 세그먼트 — 역 범위 내에 있는 것만 추가
        members.forEach((member) => {
          if (member.type !== 'way') return;
          const way = wayMap.get(member.ref);
          if (!way || !Array.isArray(way.geometry) || way.geometry.length < 2) return;
          if (roleLooksLikeStation(member.role)) return; // 역 플랫폼 way는 선로로 안 그림

          const positions = way.geometry
            .filter((pos) => Number.isFinite(pos.lon) && Number.isFinite(pos.lat))
            .map((pos) => [pos.lon, pos.lat]);
          if (positions.length < 2) return;
          const segKey = positions[0].join(',') + '|' + positions[positions.length - 1].join(',');
          const reverseKey = positions[positions.length - 1].join(',') + '|' + positions[0].join(',');
          if (segmentSeen.has(segKey) || segmentSeen.has(reverseKey)) return;
          segmentSeen.add(segKey);
          lines.push({ name, color, positions });
        });
      });

      // 관계에 포함된 노드 중 추가 누락분 보완 (이미 위치 기준으로 등록된 역은 스킵)
      elements.forEach((el) => {
        if (el.type !== 'node' || !Number.isFinite(el.lon) || !Number.isFinite(el.lat)) return;
        const tags = el.tags || {};
        if (!selectedMemberNodeIds.has(el.id)) return;
        if (isExcludedUrbanRail(tags)) return;
        const name = tags['name:ko'] || tags.name || tags.official_name || '';
        if (!name) return;
        const locKey = name.replace(/역$/, '').trim();
        if (stationSeenByLoc.has(locKey)) return; // 이미 관계에서 등록된 역 → 스킵
        stationSeenByLoc.add(locKey);
        stations.push({
          name,
          lon: el.lon,
          lat: el.lat,
          line: tags.line || tags.ref || tags.route || '',
          color: resolveColor(tags),
        });
      });

      // 폴백 정적 데이터 (위치 기준으로 이미 있는 역은 스킵)
      const fallbackStations = Array.isArray(window.KR_SUBWAY_STATIONS) ? window.KR_SUBWAY_STATIONS : [];
      fallbackStations.forEach((station) => {
        if (!Number.isFinite(Number(station.lon)) || !Number.isFinite(Number(station.lat)) || !station.name) return;
        const locKey = String(station.name).replace(/역$/, '').trim();
        if (stationSeenByLoc.has(locKey)) return;
        stationSeenByLoc.add(locKey);
        if (isExcludedUrbanRail({ name: station.name || station.nameKo || '', ref: station.line || '' })) return;
        stations.push({
          name: station.name || station.nameKo || '',
          lon: Number(station.lon),
          lat: Number(station.lat),
          line: normalizeLineName(station.line || ''),
          color: station.color || resolveColor({ ref: station.line || '', name: station.line || '' }),
        });
      });

      return { lines, stations };
    }

    async function fetchOverpass(query) {
      const endpoints = [
        'https://overpass.kumi.systems/api/interpreter',
        DATA_URL,
        'https://maps.mail.ru/osm/tools/overpass/api/interpreter'
      ];
      const requests = endpoints.map((endpoint) => new Promise(async (resolve, reject) => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 55000);
        try {
          const response = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
            body: 'data=' + encodeURIComponent(query),
            signal: controller.signal,
            cache: 'no-store',
          });
          clearTimeout(timer);
          if (!response.ok) throw new Error('HTTP ' + response.status + ' @ ' + endpoint);
          resolve(await response.json());
        } catch (error) {
          clearTimeout(timer);
          console.warn('overpass endpoint failed:', endpoint, error);
          reject(error);
        }
      }));
      if (typeof Promise.any === 'function') {
        return Promise.any(requests);
      }
      return new Promise((resolve, reject) => {
        let rejected = 0;
        let lastError = null;
        requests.forEach((request) => {
          request.then(resolve).catch((error) => {
            rejected += 1;
            lastError = error;
            if (rejected >= requests.length) reject(lastError || new Error('No overpass endpoint available'));
          });
        });
      });
    }

    function getFallbackDataset() {
      const fallbackStations = Array.isArray(window.KR_SUBWAY_STATIONS) ? window.KR_SUBWAY_STATIONS : [];
      const globalData = window.KR_SUBWAY_OVERLAY_DATA || null;
      const cached = parseCached();
      const cachedLines = Array.isArray(globalData?.lines) ? globalData.lines : (Array.isArray(cached?.data?.lines) ? cached.data.lines : []);
      const cachedStations = Array.isArray(globalData?.stations) ? globalData.stations : (Array.isArray(cached?.data?.stations) ? cached.data.stations : []);
      return {
        lines: cachedLines,
        stations: [
          ...cachedStations,
          ...fallbackStations.map((station) => ({
            name: station.name || station.nameKo || '',
            lat: Number(station.lat),
            lon: Number(station.lon),
            line: station.line || '',
            color: station.color || '#ffffff',
            aliases: Array.isArray(station.aliases) ? station.aliases.slice() : [],
          }))
        ],
      };
    }

    let hasLoadedOnce = false;
    let loadPromise = null;

    async function load() {
      if (loadPromise) return loadPromise;
      loadPromise = (async () => {
        // ① 캐시/폴백 데이터를 먼저 즉시 표시해 오버레이 공백 상태를 방지
        let cached = null;
        try {
          cached = parseCached();
          if (cached && ((cached.data || {}).lines || []).length > 0) {
            addEntities(cached.data);
            window.KR_SUBWAY_OVERLAY_DATA = cached.data;
            if (!cached.expired) {
              hasLoadedOnce = true;
              return;
            }
          } else {
            const fallbackDataset = getFallbackDataset();
            if (((fallbackDataset.lines || []).length > 0) || ((fallbackDataset.stations || []).length > 0)) {
              addEntities(fallbackDataset);
              window.KR_SUBWAY_OVERLAY_DATA = fallbackDataset;
            }
          }
        } catch (e) {
          console.warn('subway cache load failed:', e);
          try {
            const fallbackDataset = getFallbackDataset();
            if (((fallbackDataset.lines || []).length > 0) || ((fallbackDataset.stations || []).length > 0)) {
              addEntities(fallbackDataset);
              window.KR_SUBWAY_OVERLAY_DATA = fallbackDataset;
            }
          } catch (fallbackError) {
            console.warn('subway fallback load failed:', fallbackError);
          }
        }

        // ② Overpass 갱신 — 완전한 데이터가 도착할 때까지 기다렸다가 한 번에 표시
        // bbox: 한국 전체 영역 (제주 포함) — area 조회보다 훨씬 빠름
        const query = `
[out:json][timeout:50][bbox:33.0,124.5,38.7,130.0];
(
  relation["type"="route"]["route"~"subway|light_rail|monorail"];
  relation["type"="route"]["route"="train"]["name"~"GTX|공항철도|신분당|수인|분당|경의|중앙|경춘|서해|신림|우이|김포|의정부|에버라인|인천|부산|대구|대전|광주|동해|도시철도|수도권 전철", i];
);
out body;
>;
out geom qt;`;
        try {
          const raw = await fetchOverpass(query);
          const transformed = transformOverpass(raw);
          if (((transformed.lines || []).length || (transformed.stations || []).length)) {
            addEntities(transformed);
            storeCache(transformed);
            hasLoadedOnce = true;
          }
        } catch (error) {
          console.warn('Korea subway Overpass failed, will retry on next setVisible:', error);
          // hasLoadedOnce = false 유지 → 다음 setVisible(true) 시 자동 재시도
        }
      })();
      try {
        await loadPromise;
      } finally {
        loadPromise = null;
      }
    }

    load();

    return {
      setVisible(visible) {
        dataSource.show = !!visible;
        if (visible) {
          // 이미 엔티티가 있으면 재추가하지 않음 (위성↔일반 반복 전환 시 노선 사라짐 버그 방지)
          const hasEntities = dataSource.entities.values.length > 0;
          if (!hasEntities && !hasLoadedOnce) load();
          else if (!hasLoadedOnce) load();
        }
        viewer.scene.requestRender();
      },
      reload() { return load(); },
    };
  }

  function configureScene(viewer) {
    const scene = viewer.scene;
    const globe = scene.globe;
    const isMobile = window.matchMedia('(max-width: 768px)').matches;
    scene.globe.show = true;
    scene.globe.baseColor = Cesium.Color.BLACK;
    scene.globe.enableLighting = false;
    scene.globe.depthTestAgainstTerrain = false;
    // 타일 로딩 속도 핵심: 낮을수록 고품질이지만 느림. 2.5~3.5가 속도/품질 최적 균형
    scene.globe.maximumScreenSpaceError = isMobile ? 3.5 : 2.5;
    scene.globe.preloadAncestors = true;
    scene.globe.loadingDescendantsLimit = isMobile ? 6 : 12;
    // 타일 캐시 크기 증가: 스타일 변경/확대·축소 시 재다운로드 방지
    scene.globe.tileCacheSize = 400;
    scene.skyAtmosphere.show = false;
    scene.sun.show = false;
    scene.moon.show = false;
    scene.fog.enabled = false;
    scene.backgroundColor = Cesium.Color.BLACK;
    scene.highDynamicRange = false;
    scene.requestRenderMode = true;
    scene.maximumRenderTimeChange = Infinity;
    // fxaa 비활성화: 지도 뷰에서 체감 차이 없고 GPU 비용 절감
    if (scene.postProcessStages && scene.postProcessStages.fxaa) scene.postProcessStages.fxaa.enabled = false;
    scene.fxaa = false;

    // resolutionScale 1.0 고정: HiDPI 과렌더링 방지 (1.4 → 1.0이면 픽셀 수 50% 감소)
    viewer.resolutionScale = 1.0;
    viewer.targetFrameRate = isMobile ? 45 : 60;

    const controller = scene.screenSpaceCameraController;
    controller.maximumZoomDistance = HOME_VIEW.alt;
    controller.minimumZoomDistance = isMobile ? 120 : 500;
    controller.enableCollisionDetection = false;
    controller.maximumTiltAngle = Cesium.Math.toRadians(90);
    controller.inertiaSpin = isMobile ? 0.18 : 0.62;
    controller.inertiaTranslate = isMobile ? 0.34 : 0.7;
    controller.inertiaZoom = isMobile ? 0.22 : 0.64;
    controller.maximumMovementRatio = isMobile ? 0.12 : 0.16;
    controller.zoomFactor = isMobile ? 8.5 : 5.0;
    controller.zoomEventTypes = [Cesium.CameraEventType.WHEEL, Cesium.CameraEventType.PINCH];

    viewer.camera.percentageChanged = 0.05; // 0.01 → 0.05: 카메라 변경 이벤트 빈도 감소
  }

  function wireLoading(scene) {
    const loading = document.getElementById('loading');
    if (!loading) return;
    let dismissed = false;

    function dismiss() {
      if (dismissed) return;
      dismissed = true;
      loading.classList.add('out');
      setTimeout(() => loading.classList.add('gone'), 700);
    }

    // ① 타일 로딩 완료 시 즉시 dismiss
    scene.globe.tileLoadProgressEvent.addEventListener(count => {
      if (count === 0) dismiss();
    });

    // ② 2초 후 타일 개수가 충분히 적으면 dismiss (requestRenderMode에서 count=0 미도달 방지)
    setTimeout(() => {
      // 타일이 아직 로딩 중이어도 화면에 지구가 보이면 dismiss
      if (!dismissed) dismiss();
    }, 2000);

    // ③ 어떤 경우에도 5초 후 강제 dismiss
    setTimeout(dismiss, 5000);
  }

  function wireInfoBar(viewer, sharedState) {
    const scene = viewer.scene;
    const ibLat = document.getElementById('ib-lat');
    const ibLon = document.getElementById('ib-lon');
    const ibAlt = document.getElementById('ib-alt');
    const ibZoom = document.getElementById('ib-zoom');
    const ziFill = document.getElementById('zi-fill');
    const ziVal = document.getElementById('zi-val');
    const miBox = document.getElementById('mouse-info');
    const miPlace = document.getElementById('mi-place');
    const miKind = document.getElementById('mi-kind');
    const miDetail = document.getElementById('mi-detail');
    const MAX_Z = 19;

    function altToZoom(height) {
      const z = Math.round(19 - Math.log2(Math.max(1, height) / 300));
      return Math.max(0, Math.min(MAX_Z, z));
    }

    function formatAltitude(height) {
      if (height >= 1e6) return (height / 1e6).toFixed(2) + ' Mm';
      if (height >= 1e3) return (height / 1e3).toFixed(1) + ' km';
      return height.toFixed(0) + ' m';
    }

    const handler = new Cesium.ScreenSpaceEventHandler(scene.canvas);
    let reverseLookupToken = 0;
    let reverseDebounce = null;
    let latestLocationKey = '';

    function pickCartesian(screenPosition) {
      if (!screenPosition) return null;
      const ray = viewer.camera.getPickRay(screenPosition);
      return (ray && scene.globe.pick(ray, scene)) || viewer.camera.pickEllipsoid(screenPosition, scene.globe.ellipsoid);
    }

    function positionMouseInfo(pointer) {
      if (window.matchMedia('(max-width: 768px)').matches) return;
      miBox.style.display = 'block';
      miBox.style.left = Math.max(10, pointer.x - miBox.offsetWidth - 18) + 'px';
      miBox.style.top = Math.max(10, pointer.y - Math.min(20, miBox.offsetHeight / 2)) + 'px';
    }

    function setMouseInfo(primary, kind, detail, pointer) {
      let label = primary || '-';
      if (kind === '지하철역' && detail && detail.startsWith('노선: ') && detail !== '노선: ') {
        label = primary + ' (' + detail.replace('노선: ', '') + ')';
      } else if (kind === '지하철 노선') {
        label = primary + ' 노선';
      }
      // 일반 지도: label이 이미 정교하게 구성되어 있으므로 그대로 표시
      if (miPlace) miPlace.textContent = label;
      if (pointer) positionMouseInfo(pointer);
    }

    function extractPickedInfo(screenPosition) {
      if (!screenPosition) return null;
      let picked = null;
      try {
        picked = scene.pick(screenPosition);
      } catch (error) {
        picked = null;
      }
      const entity = picked && (picked.id || (picked.primitive && picked.primitive.id));
      if (!entity || !entity.properties) return null;
      const kind = Cesium.defined(entity.properties.kind) && typeof entity.properties.kind.getValue === 'function'
        ? entity.properties.kind.getValue(Cesium.JulianDate.now())
        : entity.properties.kind;
      const name = Cesium.defined(entity.properties.name) && typeof entity.properties.name.getValue === 'function'
        ? entity.properties.name.getValue(Cesium.JulianDate.now())
        : entity.properties.name;
      const line = Cesium.defined(entity.properties.line) && typeof entity.properties.line.getValue === 'function'
        ? entity.properties.line.getValue(Cesium.JulianDate.now())
        : entity.properties.line;

      if (kind === 'subway-station') {
        return {
          primary: name || '지하철역',
          kind: '지하철역',
          detail: line ? ('노선: ' + line) : '노선 정보 없음',
          exact: true,
        };
      }
      if (kind === 'subway-line') {
        return {
          primary: name || '지하철 노선',
          kind: '지하철 노선',
          detail: '노선 경로',
          exact: true,
        };
      }
      return null;
    }

    function scheduleReverseLookup(lat, lon, pointer) {
      const key = lat.toFixed(3) + ',' + lon.toFixed(3);
      if (latestLocationKey === key) {
        positionMouseInfo(pointer);
        return;
      }
      latestLocationKey = key;
      setMouseInfo('위치 확인 중...', '일반 지도', '', pointer);
      clearTimeout(reverseDebounce);
      const token = ++reverseLookupToken;
      reverseDebounce = setTimeout(async () => {
        try {
          const result = await window.WorldSearch.reverseGeocode(lat, lon);
          if (token !== reverseLookupToken || latestLocationKey !== key) return;
          const primary = result.label || (lat.toFixed(4) + ', ' + lon.toFixed(4));
          setMouseInfo(primary, '일반 지도', '', pointer);
        } catch (error) {
          if (token !== reverseLookupToken || latestLocationKey !== key) return;
          setMouseInfo(lat.toFixed(4) + ', ' + lon.toFixed(4), '일반 지도', '', pointer);
        }
      }, 120);
    }

    function updateFromCartesian(cartesian, pointer, screenPosition) {
      const cameraPosition = viewer.camera.positionCartographic;
      if (!cameraPosition) return;
      const zoom = altToZoom(cameraPosition.height);
      ziVal.textContent = 'Z' + zoom;
      ziFill.style.height = Math.round((zoom / MAX_Z) * 100) + '%';
      ibAlt.textContent = formatAltitude(cameraPosition.height);
      if (ibZoom) ibZoom.textContent = 'Z' + zoom;
      if (!cartesian || !pointer) return;

      const cartographic = Cesium.Cartographic.fromCartesian(cartesian);
      if (!cartographic) return;
      const lat = Cesium.Math.toDegrees(cartographic.latitude);
      const lon = Cesium.Math.toDegrees(cartographic.longitude);
      ibLat.textContent = (lat >= 0 ? 'N ' : 'S ') + Math.abs(lat).toFixed(4) + '°';
      ibLon.textContent = (lon >= 0 ? 'E ' : 'W ') + Math.abs(lon).toFixed(4) + '°';

      const pickedInfo = extractPickedInfo(screenPosition || pointer);
      if (pickedInfo && pickedInfo.exact) {
        latestLocationKey = 'entity:' + [pickedInfo.kind, pickedInfo.primary, pickedInfo.detail].join('|');
        reverseLookupToken += 1;
        clearTimeout(reverseDebounce);
        setMouseInfo(pickedInfo.primary, pickedInfo.kind, pickedInfo.detail, pointer);
        return;
      }

      positionMouseInfo(pointer);
      scheduleReverseLookup(lat, lon, pointer);
    }

    handler.setInputAction(movement => {
      sharedState.lastPointerPosition = { x: movement.endPosition.x, y: movement.endPosition.y };
      sharedState.lastPointerCartesian = pickCartesian(movement.endPosition);
      updateFromCartesian(sharedState.lastPointerCartesian, sharedState.lastPointerPosition, movement.endPosition);
    }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);

    handler.setInputAction(movement => {
      const position = movement.position || movement.endPosition;
      sharedState.lastPointerPosition = { x: position.x, y: position.y };
      sharedState.lastPointerCartesian = pickCartesian(position);
      updateFromCartesian(sharedState.lastPointerCartesian, sharedState.lastPointerPosition, position);
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

    scene.canvas.addEventListener('mouseleave', () => {
      sharedState.lastPointerCartesian = null;
      sharedState.lastPointerPosition = null;
      latestLocationKey = '';
      reverseLookupToken += 1;
      miBox.style.display = 'none';
    });

    scene.postRender.addEventListener(() => {
      clampCameraDistance(viewer);
      const cameraPosition = viewer.camera.positionCartographic;
      if (!cameraPosition) return;
      const zoom = altToZoom(cameraPosition.height);
      ziVal.textContent = 'Z' + zoom;
      ziFill.style.height = Math.round((zoom / MAX_Z) * 100) + '%';
      ibAlt.textContent = formatAltitude(cameraPosition.height);
      if (ibZoom) ibZoom.textContent = 'Z' + zoom;
      if (sharedState.lastPointerCartesian && sharedState.lastPointerPosition) {
        updateFromCartesian(sharedState.lastPointerCartesian, sharedState.lastPointerPosition, sharedState.lastPointerPosition);
      }
    });
  }

  function clampLatitudeRadians(latitude) {
    const maxLat = Cesium.Math.toRadians(MAX_VIEW_LATITUDE);
    return Cesium.Math.clamp(latitude, -maxLat, maxLat);
  }

  function clampCameraDistance(viewer) {
    const controller = viewer.scene.screenSpaceCameraController;
    const position = viewer.camera.positionCartographic;
    if (!position) return;

    const minHeight = controller.minimumZoomDistance || 0;
    const maxHeight = controller.maximumZoomDistance || Number.POSITIVE_INFINITY;
    const clampedHeight = Math.max(minHeight, Math.min(maxHeight, position.height));
    const clampedLatitude = clampLatitudeRadians(position.latitude);
    if (Math.abs(clampedHeight - position.height) < 1 && Math.abs(clampedLatitude - position.latitude) < Cesium.Math.toRadians(0.001)) return;

    viewer.camera.setView({
      destination: Cesium.Cartesian3.fromRadians(position.longitude, clampedLatitude, clampedHeight),
      orientation: {
        heading: viewer.camera.heading,
        pitch: viewer.camera.pitch,
        roll: viewer.camera.roll,
      },
    });
  }

  function wireHomeButton(viewer, sharedState) {
    document.getElementById('globe-home-btn').addEventListener('click', () => {
      sharedState.lastSearchResult = null;
      viewer.camera.flyTo({
        destination: Cesium.Cartesian3.fromDegrees(HOME_VIEW.lon, HOME_VIEW.lat, HOME_VIEW.alt),
        orientation: {
          heading: Cesium.Math.toRadians(HOME_VIEW.heading),
          pitch: Cesium.Math.toRadians(HOME_VIEW.pitch),
          roll: HOME_VIEW.roll,
        },
        duration: 1.8,
      });
    });
  }

  function wireSearch(viewer, sharedState) {
    const row = document.getElementById('search-row');
    const panel = document.getElementById('srch-panel');
    const btn = document.getElementById('srch-btn');
    const input = document.getElementById('srch-input');
    const clearBtn = document.getElementById('srch-clear');
    const results = document.getElementById('srch-results');
    const countLabel = document.getElementById('srch-count');
    const wrap = document.getElementById('search-wrap');

    let isOpen = false;
    let currentItems = [];
    let activeIndex = -1;
    let debounce = null;
    let queryToken = 0;

    function syncResultsWidth() {
      const width = Math.max(row.getBoundingClientRect().width, 280);
      results.style.width = width + 'px';
    }

    function syncCollapsedState() {
      const isMobile = window.matchMedia('(max-width: 768px)').matches;
      wrap.classList.toggle('is-collapsed', isMobile && !isOpen);
    }

    function openPanel() {
      isOpen = true;
      row.classList.add('is-open');
      panel.classList.add('is-open');
      btn.classList.add('is-open');
      btn.setAttribute('aria-expanded', 'true');
      syncCollapsedState();
      requestAnimationFrame(syncResultsWidth);
      setTimeout(() => input.focus(), 50);
    }

    function closePanel() {
      isOpen = false;
      row.classList.remove('is-open', 'has-results');
      panel.classList.remove('is-open');
      btn.classList.remove('is-open');
      btn.setAttribute('aria-expanded', 'false');
      results.style.display = 'none';
      activeIndex = -1;
      currentItems = [];
      syncCollapsedState();
    }

    function renderResults(items) {
      currentItems = items;
      activeIndex = -1;
      if (!items.length) {
        syncResultsWidth();
        results.innerHTML = '<div class="r-msg">검색 결과가 없습니다.</div>';
        results.style.display = 'block';
        row.classList.add('has-results');
        countLabel.textContent = '0건';
        return;
      }

      syncResultsWidth();
      results.innerHTML = '';
      items.forEach((item, index) => {
        const meta = window.WorldSearch.getResultLabel(item);
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'r-item';
        const icon = item.type === 'station' ? '🚉' : item.type === 'country' ? '🌐' : item.isCapital ? '🏛️' : '🏙️';
        const kind = item.type === 'station' ? '지하철역' : item.type === 'country' ? '나라' : item.isCapital ? '수도' : '도시';
        button.innerHTML = `
          <span class="r-ico">${icon}</span>
          <span class="r-txt">
            <span class="r-name">${escapeHtml(meta.primary)}</span>
            <span class="r-sub">${escapeHtml(meta.secondary)}</span>
          </span>
          <span class="r-kind">${kind}</span>
        `;
        button.addEventListener('click', () => flyToResult(item));
        button.addEventListener('mouseenter', () => setActive(index));
        results.appendChild(button);
      });
      results.style.display = 'block';
      row.classList.add('has-results');
      countLabel.textContent = items.length + '건';
    }

    function setActive(index) {
      const elements = results.querySelectorAll('.r-item');
      if (!elements.length) return;
      activeIndex = Math.max(0, Math.min(elements.length - 1, index));
      elements.forEach((element, itemIndex) => element.classList.toggle('act', itemIndex === activeIndex));
      elements[activeIndex].scrollIntoView({ block: 'nearest' });
    }

    async function searchLocal(query) {
      const token = ++queryToken;
      countLabel.textContent = '검색중';
      const list = await window.WorldSearch.searchPlaces(query, { maxResults: 12 });
      if (token !== queryToken) return;
      renderResults(list);
    }

    function flyToResult(item) {
      const fly = window.WorldSearch.getFlyToOptions(item);
      const safeLat = Cesium.Math.clamp(item.lat, -MAX_VIEW_LATITUDE, MAX_VIEW_LATITUDE);
      const isKrLocalArea = item.type !== 'country' && String(item.countryCode || '').toUpperCase() === 'KR' && /(동|읍|면|리)$/u.test(String(item.nameKo || item.nameEn || item.name || '').trim());
      const spanByZoom = { 5: 18, 6: 12, 7: 8, 8: 4.8, 9: 2.4, 10: 1.2, 11: 0.45, 12: 0.18, 13: 0.08, 14: 0.04, 15: 0.02, 16: 0.012 };
      // 국가는 zoom 6, 일반 위치는 14, 한국 동/읍/면/리는 더 가깝게 진입
      const defaultZoom = item.type === 'country' ? 6 : (isKrLocalArea ? 16 : 14);
      const zoomKey = Math.max(5, Math.min(16, Number(item.type === 'country' ? (item.zoom || defaultZoom) : defaultZoom)));
      const latSpan = spanByZoom[zoomKey] ?? 0.04;
      const lonSpan = latSpan / Math.max(0.35, Math.cos(Cesium.Math.toRadians(safeLat)));
      const finalAltitude = isKrLocalArea ? 650 : (item.type === 'station' ? 1500 : fly.altitude);
      const rectangle = Cesium.Rectangle.fromDegrees(
        item.lon - lonSpan / 2,
        Cesium.Math.clamp(safeLat - latSpan / 2, -MAX_VIEW_LATITUDE, MAX_VIEW_LATITUDE),
        item.lon + lonSpan / 2,
        Cesium.Math.clamp(safeLat + latSpan / 2, -MAX_VIEW_LATITUDE, MAX_VIEW_LATITUDE)
      );
      viewer.camera.flyTo({
        destination: rectangle,
        orientation: { heading: 0, pitch: Cesium.Math.toRadians(-90), roll: 0 },
        duration: 1.8,
        easingFunction: Cesium.EasingFunction.CUBIC_IN_OUT,
        complete: () => {
          viewer.camera.setView({
            destination: Cesium.Cartesian3.fromDegrees(item.lon, safeLat, finalAltitude),
            orientation: { heading: 0, pitch: Cesium.Math.toRadians(-90), roll: 0 },
          });
        },
      });
      sharedState.lastSearchResult = item;
      const label = item.type === 'country'
        ? (item.nameKo || item.nameEn)
        : item.type === 'station'
          ? (item.nameKo || item.nameEn || item.name) + (((item.line || '') || (item.countryKo || item.countryEn)) ? ' · ' + ([item.line, item.countryKo || item.countryEn].filter(Boolean).join(' · ')) : '')
          : (item.nameKo || item.nameEn) + ((item.countryKo || item.countryEn) ? ' · ' + (item.countryKo || item.countryEn) : '');
      input.value = label;
      clearBtn.style.display = 'inline-flex';
      results.style.display = 'none';
      row.classList.remove('has-results');
      setTimeout(() => input.focus(), 20);
    }

    btn.addEventListener('click', () => { isOpen ? closePanel() : openPanel(); });
    clearBtn.addEventListener('click', () => {
      input.value = '';
      clearBtn.style.display = 'none';
      results.style.display = 'none';
      row.classList.remove('has-results');
      input.focus();
      countLabel.textContent = '0건';
      queryToken += 1;
    });

    input.addEventListener('input', () => {
      clearTimeout(debounce);
      const query = input.value.trim();
      clearBtn.style.display = query ? 'inline-flex' : 'none';
      if (!query) {
        results.style.display = 'none';
        row.classList.remove('has-results');
        countLabel.textContent = '0건';
        queryToken += 1;
        return;
      }
      debounce = setTimeout(() => searchLocal(query), 120);
    });

    input.addEventListener('keydown', event => {
      if (event.key === 'Escape') { event.preventDefault(); closePanel(); return; }
      if (!currentItems.length) return;
      if (event.key === 'ArrowDown') { event.preventDefault(); setActive(activeIndex + 1); }
      if (event.key === 'ArrowUp') { event.preventDefault(); setActive(activeIndex - 1); }
      if (event.key === 'Enter') {
        event.preventDefault();
        const item = currentItems[activeIndex >= 0 ? activeIndex : 0];
        if (item) flyToResult(item);
      }
    });

    document.addEventListener('keydown', event => {
      if (document.activeElement === input) return;
      if (event.key === '/' || (event.ctrlKey && event.key.toLowerCase() === 'f')) {
        event.preventDefault();
        if (!isOpen) openPanel(); else input.focus();
      }
      if (event.key.toLowerCase() === 'h') {
        viewer.camera.flyTo({
          destination: Cesium.Cartesian3.fromDegrees(HOME_VIEW.lon, HOME_VIEW.lat, HOME_VIEW.alt),
          orientation: { heading: 0, pitch: Cesium.Math.toRadians(HOME_VIEW.pitch), roll: 0 },
          duration: 1.8,
        });
      }
    });

    document.addEventListener('click', event => {
      if (!wrap.contains(event.target) && isOpen) {
        results.style.display = 'none';
        row.classList.remove('has-results');
      }
    });
    window.addEventListener('resize', () => {
      syncCollapsedState();
      syncResultsWidth();
    });
    syncCollapsedState();
    syncResultsWidth();
  }

  function wireShare(viewer, sharedState, styleManager) {
    const toast = document.getElementById('toast');
    const copyBtn = document.getElementById('copy-link-btn');
    const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);

    function getCameraView() {
      const carto = viewer.camera.positionCartographic;
      return {
        lon: Cesium.Math.toDegrees(carto.longitude),
        lat: Cesium.Math.toDegrees(carto.latitude),
        alt: carto.height,
        heading: Cesium.Math.toDegrees(viewer.camera.heading),
        pitch: Cesium.Math.toDegrees(viewer.camera.pitch),
        style: sharedState.currentStyle || DEFAULT_STYLE,
      };
    }

    function makeShareUrl() {
      const v = getCameraView();
      const hash = [
        'lon=' + v.lon.toFixed(6),
        'lat=' + v.lat.toFixed(6),
        'alt=' + Math.round(v.alt),
        'heading=' + v.heading.toFixed(2),
        'pitch=' + v.pitch.toFixed(2),
        'style=' + encodeURIComponent(v.style),
      ].join('&');
      return location.origin + location.pathname + '#' + hash;
    }

    function syncHash() {
      const url = makeShareUrl();
      history.replaceState(null, '', url);
    }

    async function copyShareUrl() {
      const url = makeShareUrl();
      try {
        await navigator.clipboard.writeText(url);
        showToast('링크가 복사되었습니다.');
      } catch (error) {
        prompt('링크를 복사하세요', url);
      }
    }

    function showToast(message) {
      toast.textContent = message;
      toast.classList.add('show');
      clearTimeout(sharedState.shareToastTimer);
      sharedState.shareToastTimer = setTimeout(() => toast.classList.remove('show'), 1800);
    }

    copyBtn.addEventListener('click', copyShareUrl);
    viewer.scene.canvas.addEventListener('contextmenu', event => event.preventDefault());
    handler.setInputAction(copyShareUrl, Cesium.ScreenSpaceEventType.RIGHT_CLICK);
    viewer.camera.moveEnd.addEventListener(syncHash);
    syncHash();
  }



  function closeOtherPanels(exceptId) {
    document.querySelectorAll('.tool-panel.open').forEach((panel) => {
      if (!exceptId || panel.id !== exceptId) panel.classList.remove('open');
    });
  }

  function wirePanelExclusivity() {
    document.addEventListener('click', (event) => {
      const target = event.target;
      const inPanel = target.closest('.tool-panel');
      const isToggle = target.closest('#style-toggle-btn, #favorites-toggle-btn');
      if (!inPanel && !isToggle) closeOtherPanels(null);
    });
  }

  function readViewFromHash() {
    if (!location.hash) return null;
    const hash = location.hash.replace(/^#/, '');
    const params = new URLSearchParams(hash.replace(/&/g, '&'));
    const lon = Number(params.get('lon'));
    const lat = Number(params.get('lat'));
    const alt = Number(params.get('alt'));
    if (!Number.isFinite(lon) || !Number.isFinite(lat) || !Number.isFinite(alt)) return null;
    return {
      lon,
      lat,
      alt,
      heading: Number(params.get('heading') || 0),
      pitch: Number(params.get('pitch') || -90),
      style: params.get('style') || DEFAULT_STYLE,
    };
  }


  function positionPanelNearButton(panel, button, options = {}) {
    const isMobile = window.matchMedia('(max-width: 768px)').matches;
    if (isMobile) {
      // 모바일: 하단 고정 시트 (CSS가 처리)
      panel.style.top = '';
      panel.style.left = '';
      panel.style.right = '';
      panel.style.bottom = '';
      return;
    }
    const gap = options.gap || 12;
    const offsetY = options.offsetY || 0;
    const buttonRect = button.getBoundingClientRect();
    const panelRect = panel.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const top = Math.min(
      Math.max(10, buttonRect.top + buttonRect.height / 2 - panelRect.height / 2 + offsetY),
      viewportHeight - panelRect.height - 10,
    );
    const left = Math.max(10, Math.min(viewportWidth - panelRect.width - 10, buttonRect.left - panelRect.width - gap));
    panel.style.top = top + 'px';
    panel.style.left = left + 'px';
    panel.style.right = 'auto';
    panel.style.bottom = 'auto';
  }

  function wireCurrentLocation(viewer) {
    const btn = document.getElementById('my-location-btn');
    btn.addEventListener('click', () => {
      if (!navigator.geolocation) {
        alert('이 브라우저는 현재 위치 기능을 지원하지 않습니다.');
        return;
      }
      btn.disabled = true;
      navigator.geolocation.getCurrentPosition(position => {
        const { latitude, longitude } = position.coords;
        viewer.camera.flyTo({
          destination: Cesium.Cartesian3.fromDegrees(longitude, latitude, 7000),
          orientation: { heading: 0, pitch: Cesium.Math.toRadians(-90), roll: 0 },
          duration: 1.6,
          complete: () => { btn.disabled = false; },
        });
      }, error => {
        btn.disabled = false;
        alert('현재 위치를 가져오지 못했습니다. 위치 권한을 확인해 주세요.');
        console.warn(error);
      }, { enableHighAccuracy: true, maximumAge: 15000, timeout: 10000 });
    });
  }

  function wireStylePicker(viewer, styleManager, sharedState) {
    const panel = document.getElementById('style-panel');
    const btn = document.getElementById('style-toggle-btn');
    const buttons = Array.from(panel.querySelectorAll('[data-style]'));

    function apply(style) {
      sharedState.currentStyle = styleManager.setStyle(style);
      buttons.forEach(item => item.classList.toggle('active', item.dataset.style === sharedState.currentStyle));
    }

    function togglePanel() {
      const willOpen = !panel.classList.contains('open');
      closeOtherPanels(willOpen ? panel.id : null);
      panel.classList.toggle('open', willOpen);
      if (willOpen) {
        requestAnimationFrame(() => positionPanelNearButton(panel, btn, { offsetY: 16 }));
      }
    }

    btn.addEventListener('click', (event) => {
      event.stopPropagation();
      togglePanel();
    });
    panel.addEventListener('click', (event) => event.stopPropagation());
    window.addEventListener('resize', () => {
      if (panel.classList.contains('open')) positionPanelNearButton(panel, btn, { offsetY: 16 });
    });
    buttons.forEach(item => item.addEventListener('click', () => {
      apply(item.dataset.style);
      // 선택 후 패널 자동 닫힘
      setTimeout(() => {
        panel.classList.remove('open');
      }, 150);
    }));
    apply(sharedState.currentStyle || DEFAULT_STYLE);
  }

  function wireMiniMap(viewer) {
    const canvas = document.getElementById('minimap-canvas');
    const ctx = canvas.getContext('2d');
    const bg = new Image();
    bg.src = 'earth-loading.png';

    function resizeCanvas() {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const width = Math.max(64, Math.round(rect.width * dpr));
      const height = Math.max(64, Math.round(rect.height * dpr));
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
    }

    function draw() {
      resizeCanvas();
      const size = Math.min(canvas.width, canvas.height);
      const cx = canvas.width / 2;
      const cy = canvas.height / 2;
      const radius = size / 2 - 8;
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.closePath();
      ctx.clip();
      if (bg.complete) {
        ctx.drawImage(bg, cx - radius, cy - radius, radius * 2, radius * 2);
      } else {
        ctx.fillStyle = '#09172f';
        ctx.fillRect(cx - radius, cy - radius, radius * 2, radius * 2);
      }
      ctx.restore();

      ctx.strokeStyle = 'rgba(255,255,255,.22)';
      ctx.lineWidth = Math.max(2, canvas.width / 60);
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.stroke();

      const carto = viewer.camera.positionCartographic;
      if (!carto) return;
      const lon = Cesium.Math.toDegrees(carto.longitude);
      const lat = Cesium.Math.toDegrees(carto.latitude);
      const x = cx - radius + ((lon + 180) / 360) * (radius * 2);
      const y = cy - radius + ((90 - lat) / 180) * (radius * 2);

      ctx.strokeStyle = 'rgba(255,255,255,.8)';
      ctx.lineWidth = Math.max(2, canvas.width / 70);
      ctx.beginPath();
      ctx.arc(x, y, Math.max(5, canvas.width / 24), 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = '#60a5fa';
      ctx.beginPath();
      ctx.arc(x, y, Math.max(3, canvas.width / 36), 0, Math.PI * 2);
      ctx.fill();
    }

    bg.onload = draw;
    viewer.camera.changed.addEventListener(draw);
    window.addEventListener('resize', draw);
    draw();
  }

  function wireFavorites(viewer, sharedState) {
    const btn = document.getElementById('favorites-toggle-btn');
    const panel = document.getElementById('favorites-panel');
    const list = document.getElementById('favorites-list');
    const addCurrentBtn = document.getElementById('fav-add-current');
    const addManualBtn = document.getElementById('fav-add-manual');
    const nameInput = document.getElementById('fav-name');
    const coordsInput = document.getElementById('fav-coords');
    const postalInput = document.getElementById('fav-postal');
    const editIdInput = document.getElementById('fav-edit-id');

    let favorites = loadFavorites();

    function togglePanel() {
      const willOpen = !panel.classList.contains('open');
      closeOtherPanels(willOpen ? panel.id : null);
      panel.classList.toggle('open', willOpen);
      if (willOpen) {
        requestAnimationFrame(() => positionPanelNearButton(panel, btn));
      }
    }
    btn.addEventListener('click', (event) => { event.stopPropagation(); togglePanel(); });
    panel.addEventListener('click', (event) => event.stopPropagation());
    window.addEventListener('resize', () => {
      if (panel.classList.contains('open')) positionPanelNearButton(panel, btn);
    });

    function saveFavorites() { localStorage.setItem(FAVORITES_KEY, JSON.stringify(favorites)); }
    function resetForm() {
      editIdInput.value = '';
      nameInput.value = '';
      coordsInput.value = '';
      postalInput.value = '';
    }

    function renderFavorites() {
      if (!favorites.length) {
        list.innerHTML = '<div class="fav-empty">저장된 위치가 없습니다.</div>';
        return;
      }
      list.innerHTML = '';
      favorites.forEach(item => {
        const el = document.createElement('div');
        el.className = 'fav-item';
        el.innerHTML = `
          <div class="fav-text">
            <div class="fav-name">${escapeHtml(item.name)}</div>
            <div class="fav-sub">${escapeHtml(item.sourceLabel || `${item.lat.toFixed(4)}, ${item.lon.toFixed(4)}`)}</div>
          </div>
          <div class="fav-actions">
            <button type="button" data-go="${item.id}">이동</button>
            <button type="button" data-edit="${item.id}">수정</button>
            <button type="button" data-del="${item.id}">삭제</button>
          </div>
        `;
        list.appendChild(el);
      });

      list.querySelectorAll('[data-go]').forEach(btn => btn.addEventListener('click', () => {
        const item = favorites.find(f => f.id === btn.dataset.go);
        if (!item) return;
        viewer.camera.flyTo({
          destination: Cesium.Cartesian3.fromDegrees(item.lon, item.lat, item.alt || 85000),
          orientation: { heading: 0, pitch: Cesium.Math.toRadians(-90), roll: 0 },
          duration: 1.4,
        });
      }));
      list.querySelectorAll('[data-edit]').forEach(btn => btn.addEventListener('click', () => {
        const item = favorites.find(f => f.id === btn.dataset.edit);
        if (!item) return;
        editIdInput.value = item.id;
        nameInput.value = item.name;
        coordsInput.value = item.lat.toFixed(6) + ', ' + item.lon.toFixed(6);
        postalInput.value = item.postalCode || '';
      }));
      list.querySelectorAll('[data-del]').forEach(btn => btn.addEventListener('click', () => {
        favorites = favorites.filter(f => f.id !== btn.dataset.del);
        saveFavorites();
        renderFavorites();
        if (editIdInput.value === btn.dataset.del) resetForm();
      }));
    }

    function makeUniqueFavoriteName(baseName, ignoreId = '') {
      const fallback = String(baseName || '').trim() || '선택 위치';
      const normalizedBase = fallback.trim().toLowerCase();
      const existingNames = new Set(
        favorites
          .filter(item => !ignoreId || item.id !== ignoreId)
          .map(item => String(item.name || '').trim().toLowerCase())
      );

      if (!existingNames.has(normalizedBase)) {
        return fallback;
      }

      let suffix = 2;
      while (existingNames.has((fallback + ' ' + suffix).trim().toLowerCase())) {
        suffix += 1;
      }
      return `${fallback} ${suffix}`;
    }

    function buildAutoFavoriteName(place, lat, lon) {
      const country = String(place?.country || '').trim();
      const city = String(place?.city || '').trim();
      const label = String(place?.label || '').trim();
      const base = (country && city)
        ? `${country} - ${city}`
        : (country || city || label || `${lat.toFixed(4)}, ${lon.toFixed(4)}`);
      return makeUniqueFavoriteName(base);
    }

    function upsertFavorite(payload) {
      const nextPayload = { ...payload };
      nextPayload.name = String(nextPayload.name || '').trim() || '선택 위치';

      if (editIdInput.value) {
        nextPayload.name = makeUniqueFavoriteName(nextPayload.name, editIdInput.value);
        favorites = favorites.map(item => item.id === editIdInput.value ? { ...item, ...nextPayload, id: item.id } : item);
      } else {
        nextPayload.name = makeUniqueFavoriteName(nextPayload.name);
        const duplicate = favorites.find(item => Math.abs(item.lat - nextPayload.lat) < 0.00001 && Math.abs(item.lon - nextPayload.lon) < 0.00001);
        if (!duplicate) {
          favorites.unshift({ id: 'fav_' + Date.now(), ...nextPayload });
        }
      }
      saveFavorites();
      renderFavorites();
      resetForm();
    }

    async function saveFavoriteAtLocation(lat, lon, options = {}) {
      const place = options.place || await window.WorldSearch.reverseGeocode(lat, lon).catch(() => null);
      const manualName = String(options.name || '').trim();
      const name = manualName || buildAutoFavoriteName(place, lat, lon);
      const sourceLabel = options.sourceLabel || place?.label || `${lat.toFixed(4)}, ${lon.toFixed(4)}`;
      upsertFavorite({ name, lat, lon, alt: options.alt || 85000, sourceLabel });
      return { name, sourceLabel };
    }

    sharedState.saveFavoriteAtLocation = saveFavoriteAtLocation;

    addCurrentBtn.addEventListener('click', async () => {
      const inputName = (nameInput.value || '').trim();
      const carto = viewer.camera.positionCartographic;
      if (!carto) return;
      const lat = Cesium.Math.toDegrees(carto.latitude);
      const lon = Cesium.Math.toDegrees(carto.longitude);
      let place = null;
      let sourceLabel = '';
      try {
        place = await window.WorldSearch.reverseGeocode(lat, lon);
        sourceLabel = place?.label || '';
      } catch (error) { console.warn(error); }
      const name = inputName || buildAutoFavoriteName(place, lat, lon);
      upsertFavorite({ name, lat, lon, alt: carto.height, sourceLabel });
    });

    addManualBtn.addEventListener('click', async () => {
      const name = (nameInput.value || '').trim();
      if (!name) {
        alert('즐겨찾기 이름을 입력해 주세요.');
        return;
      }
      const coords = parseLatLon(coordsInput.value);
      if (coords) {
        upsertFavorite({ name, lat: coords.lat, lon: coords.lon, alt: 85000, sourceLabel: '직접 좌표 입력' });
        return;
      }
      const postal = (postalInput.value || '').trim();
      if (!postal) {
        alert('위도/경도 또는 우편번호를 입력해 주세요.');
        return;
      }
      try {
        const resolved = await geocodePostal(postal);
        if (!resolved) {
          alert('우편번호 위치를 찾지 못했습니다.');
          return;
        }
        upsertFavorite({ name, lat: resolved.lat, lon: resolved.lon, alt: 85000, postalCode: postal, sourceLabel: resolved.label || '우편번호 입력' });
      } catch (error) {
        console.warn(error);
        alert('우편번호 위치를 찾지 못했습니다.');
      }
    });

    const middleHandler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
    middleHandler.setInputAction(async movement => {
      const screenPos = movement.position;
      const cartesian = viewer.camera.pickEllipsoid(screenPos, viewer.scene.globe.ellipsoid);
      if (!cartesian) return;
      const cartographic = Cesium.Cartographic.fromCartesian(cartesian);
      if (!cartographic) return;
      const lat = Cesium.Math.toDegrees(cartographic.latitude);
      const lon = Cesium.Math.toDegrees(cartographic.longitude);
      try {
        await saveFavoriteAtLocation(lat, lon, { alt: viewer.camera.positionCartographic?.height || 85000 });
      } catch (error) {
        console.warn(error);
      }
    }, Cesium.ScreenSpaceEventType.MIDDLE_CLICK);

    renderFavorites();
  }

  function loadFavorites() {
    try {
      const raw = JSON.parse(localStorage.getItem(FAVORITES_KEY) || '[]');
      return Array.isArray(raw) ? raw : [];
    } catch (error) {
      return [];
    }
  }

  function parseLatLon(value) {
    const text = String(value || '').trim();
    if (!text) return null;
    const parts = text.split(/[\s,]+/).filter(Boolean);
    if (parts.length < 2) return null;
    const lat = Number(parts[0]);
    const lon = Number(parts[1]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    return { lat, lon };
  }

  async function geocodePostal(postal) {
    const url = 'https://geocode.arcgis.com/arcgis/rest/services/World/GeocodeServer/findAddressCandidates?f=json&maxLocations=1&langCode=KO&outFields=*&singleLine=' + encodeURIComponent(postal);
    const response = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!response.ok) return null;
    const data = await response.json();
    const item = Array.isArray(data.candidates) ? data.candidates[0] : null;
    if (!item || !item.location) return null;
    return {
      lat: Number(item.location.y),
      lon: Number(item.location.x),
      label: item.address || item.attributes?.LongLabel || postal,
    };
  }

  function wireMobileGestures(viewer) {
    const isMobile = window.matchMedia('(max-width: 768px)').matches;
    if (!isMobile) return;
    const controller = viewer.scene.screenSpaceCameraController;
    const canvas = viewer.scene.canvas;
    controller.bounceAnimationTime = 0;
    controller.inertiaSpin = 0.12;
    controller.inertiaTranslate = 0.26;
    controller.inertiaZoom = 0.18;
    controller.enableTilt = false;
    controller.enableLook = false;
    controller.enableRotate = true;
    controller.tiltEventTypes = [];
    controller.lookEventTypes = [];
    controller.zoomFactor = 9.0;
    canvas.style.touchAction = 'none';

    // 모바일도 PC처럼 정북향 + 탑다운 각도 고정
    let lockCameraSync = false;
    let syncQueued = false;
    const syncTopDownCamera = () => {
      if (lockCameraSync) return;
      const position = viewer.camera.positionCartographic;
      if (!position) return;
      const heading = Cesium.Math.negativePiToPi(viewer.camera.heading || 0);
      const pitch = viewer.camera.pitch || Cesium.Math.toRadians(-90);
      const headingDiff = Math.abs(heading);
      const pitchDiff = Math.abs(pitch - Cesium.Math.toRadians(-90));
      if (headingDiff < Cesium.Math.toRadians(0.05) && pitchDiff < Cesium.Math.toRadians(0.05)) return;
      lockCameraSync = true;
      viewer.camera.setView({
        destination: Cesium.Cartesian3.fromRadians(position.longitude, position.latitude, position.height),
        orientation: {
          heading: 0,
          pitch: Cesium.Math.toRadians(-90),
          roll: 0,
        },
      });
      lockCameraSync = false;
    };
    const queueTopDownSync = () => {
      if (syncQueued) return;
      syncQueued = true;
      requestAnimationFrame(() => {
        syncQueued = false;
        syncTopDownCamera();
      });
    };
    viewer.camera.changed.addEventListener(queueTopDownSync);
    viewer.camera.moveEnd.addEventListener(syncTopDownCamera);
    syncTopDownCamera();

    // 모바일 브라우저 pull-to-refresh / 확대 제스처로 UI가 사라지는 현상 방지
    let touchCount = 0;
    document.documentElement.style.overscrollBehavior = 'none';
    document.body.style.overscrollBehavior = 'none';
    document.body.style.userSelect = 'none';
    document.body.style.webkitUserSelect = 'none';
    canvas.style.webkitTapHighlightColor = 'transparent';
    canvas.style.userSelect = 'none';
    canvas.style.webkitUserSelect = 'none';

    const updateTouchCount = (event) => { touchCount = event.touches ? event.touches.length : 0; };
    window.addEventListener('touchstart', updateTouchCount, { passive: true });
    window.addEventListener('touchend', updateTouchCount, { passive: true });
    window.addEventListener('touchcancel', () => { touchCount = 0; }, { passive: true });
    window.addEventListener('touchmove', (event) => {
      if (touchCount >= 2 || window.scrollY <= 0) event.preventDefault();
    }, { passive: false });
    window.addEventListener('pageshow', () => {
      queueTopDownSync();
      viewer.resize();
      viewer.scene.requestRender();
    });

    document.body.classList.toggle('is-touch', true);
  }

  function escapeHtml(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
}());
