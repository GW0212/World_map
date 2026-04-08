(function () {
  'use strict';

  const countries = Array.isArray(window.WORLD_COUNTRIES) ? window.WORLD_COUNTRIES : [];
  const cities = Array.isArray(window.WORLD_CITIES) ? window.WORLD_CITIES : [];

  function stripDiacritics(value) {
    return String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .normalize('NFC');
  }

  function normalizeText(value) {
    return stripDiacritics(value)
      .toLowerCase()
      .trim()
      .replace(/[()\[\]{}]/g, ' ')
      .replace(/[·•]/g, ' ')
      .replace(/[‐‑–—,/]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function denseText(value) {
    return normalizeText(value).replace(/\s+/g, '');
  }

  function uniqueStrings(values) {
    const seen = new Set();
    const result = [];
    for (const raw of values || []) {
      const value = String(raw || '').trim();
      if (!value) continue;
      const key = value.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      result.push(value);
    }
    return result;
  }

  function safeNumber(value) {
    const num = Number(value);
    return Number.isFinite(num) ? num : null;
  }

  function entryAliases(entry) {
    return uniqueStrings([
      entry.nameKo,
      entry.nameEn,
      entry.code,
      entry.countryCode,
      entry.countryKo,
      entry.countryEn,
      ...(entry.aliases || []),
    ]);
  }

  function tokenizeEntry(entry) {
    const aliases = entryAliases(entry);
    const denseAliases = uniqueStrings(aliases.map(denseText).filter(Boolean));
    const normalizedAliases = uniqueStrings(aliases.map(normalizeText).filter(Boolean));
    const nameDense = denseText(entry.nameKo || entry.nameEn || '');
    const countryDense = denseText(entry.type === 'country' ? (entry.nameKo || entry.nameEn || '') : (entry.countryKo || entry.countryEn || ''));

    return {
      ...entry,
      aliases,
      _denseAliases: denseAliases,
      _normalizedAliases: normalizedAliases,
      _nameDense: nameDense,
      _countryDense: countryDense,
      _labelDense: denseText([entry.nameKo || entry.nameEn || '', entry.countryKo || entry.countryEn || ''].filter(Boolean).join(' ')),
    };
  }

  const indexedCountries = countries
    .filter(item => safeNumber(item.lat) !== null && safeNumber(item.lon) !== null)
    .map(item => tokenizeEntry({
      ...item,
      type: 'country',
      lat: Number(item.lat),
      lon: Number(item.lon),
      zoom: Number(item.zoom || 6),
      isCapital: false,
      priority: 50,
    }));

  const capitalEntries = countries
    .filter(item => safeNumber(item.capitalLat) !== null && safeNumber(item.capitalLon) !== null && item.capital)
    .map(item => tokenizeEntry({
      nameKo: '',
      nameEn: item.capital,
      countryCode: item.code,
      countryKo: item.nameKo,
      countryEn: item.nameEn,
      lat: Number(item.capitalLat),
      lon: Number(item.capitalLon),
      zoom: 10,
      isCapital: true,
      priority: 25,
      aliases: uniqueStrings([item.capital, `${item.nameKo} ${item.capital}`, `${item.nameEn} ${item.capital}`]),
      type: 'city',
    }));

  const indexedCities = cities.map(item => tokenizeEntry({
    ...item,
    type: 'city',
    lat: Number(item.lat),
    lon: Number(item.lon),
    zoom: Number(item.zoom || (item.isCapital ? 9 : 10)),
    priority: Number(item.priority || (item.isCapital ? 30 : 80)),
  }));

  const allCities = [...indexedCities, ...capitalEntries];
  const allEntries = [...allCities, ...indexedCountries];

  const countryAliasMap = new Map();
  const countryCodeMap = new Map();
  indexedCountries.forEach(country => {
    countryCodeMap.set(String(country.code || '').toUpperCase(), country);
    entryAliases(country).forEach(alias => {
      const dense = denseText(alias);
      if (!dense) return;
      if (!countryAliasMap.has(dense)) countryAliasMap.set(dense, country);
    });
  });

  function splitStructuredQuery(query) {
    const cleaned = normalizeText(query);
    const parts = cleaned.split(/\s+-\s+|\s*,\s+/).map(part => part.trim()).filter(Boolean);
    return parts.length ? parts : cleaned.split(/\s+/).filter(Boolean);
  }

  function extractCountryCandidates(query) {
    const denseQuery = denseText(query);
    const found = new Map();
    for (const [aliasDense, country] of countryAliasMap.entries()) {
      if (!aliasDense) continue;
      if (denseQuery.includes(aliasDense)) {
        found.set(country.code, country);
      }
    }
    return [...found.values()];
  }

  function getQueryProfile(query) {
    const normalized = normalizeText(query);
    const dense = denseText(query);
    const parts = splitStructuredQuery(query);
    const denseParts = uniqueStrings(parts.map(denseText).filter(Boolean));
    const mentionedCountries = extractCountryCandidates(query);
    const denseWithoutCountries = denseParts.filter(part => !mentionedCountries.some(country => country._denseAliases.includes(part) || country._nameDense === part));
    return {
      raw: query,
      normalized,
      dense,
      parts,
      denseParts,
      mentionedCountries,
      mentionedCountryCodes: new Set(mentionedCountries.map(country => country.code)),
      denseWithoutCountries,
      hasStructuredCountry: mentionedCountries.length > 0,
    };
  }

  function hasHangul(value) {
    return /[ㄱ-ㆎ가-힣]/.test(String(value || ''));
  }

  function aliasMatchMeta(entry, queryNorm, queryDense) {
    let best = { level: 0, exact: false, prefix: false, startsWord: false, denseExact: false };
    for (const alias of entry._normalizedAliases) {
      if (!alias) continue;
      const aliasDense = denseText(alias);
      const exactNorm = alias === queryNorm;
      const exactDense = aliasDense === queryDense;
      const prefixNorm = alias.startsWith(queryNorm);
      const prefixDense = aliasDense.startsWith(queryDense);
      const startsWord = alias.split(/\s+/).some(part => part.startsWith(queryNorm));
      const containsWord = alias.split(/\s+/).some(part => part.includes(queryNorm));
      let level = 0;
      if (exactDense || exactNorm) level = 6;
      else if (prefixDense || prefixNorm) level = 5;
      else if (startsWord) level = 4;
      else if (containsWord) level = 2;
      else if (alias.includes(queryNorm) || aliasDense.includes(queryDense)) level = 1;
      if (level > best.level) {
        best = {
          level,
          exact: exactNorm || exactDense,
          prefix: prefixNorm || prefixDense,
          startsWord,
          denseExact: exactDense,
        };
      }
    }
    return best;
  }

  function cityNameMatchMeta(entry, queryNorm, queryDense) {
    const nameNorm = normalizeText(entry.nameKo || entry.nameEn || '');
    const nameDense = denseText(entry.nameKo || entry.nameEn || '');
    if (!queryDense) return { level: 0, exact: false, prefix: false };
    if (nameDense === queryDense || nameNorm === queryNorm) return { level: 6, exact: true, prefix: true };
    if (nameDense.startsWith(queryDense) || nameNorm.startsWith(queryNorm)) return { level: 5, exact: false, prefix: true };
    if (nameNorm.split(/\s+/).some(part => part.startsWith(queryNorm))) return { level: 4, exact: false, prefix: true };
    if (nameNorm.includes(queryNorm) || nameDense.includes(queryDense)) return { level: 2, exact: false, prefix: false };
    return { level: 0, exact: false, prefix: false };
  }

  function preferredCountryBias(entry, profile) {
    if (!hasHangul(profile.raw)) return 0;
    const isSingleShortHangul = profile.denseParts.length === 1 && profile.dense.length <= 6;
    const krBoost = isSingleShortHangul ? 420 : 220;
    const kpPenalty = isSingleShortHangul ? -260 : -120;
    if (entry.countryCode === 'KR') return krBoost;
    if (entry.countryCode === 'KP') return kpPenalty;
    if (entry.code === 'KR') return krBoost;
    if (entry.code === 'KP') return kpPenalty;
    return 0;
  }

  function scoreEntry(entry, profile) {
    const queryDense = profile.dense;
    const queryNorm = profile.normalized;
    if (!queryDense) return -Infinity;

    const aliasMeta = aliasMatchMeta(entry, queryNorm, queryDense);
    const partMatches = profile.denseParts
      .map((part, idx) => aliasMatchMeta(entry, profile.parts[idx] || part, part))
      .filter(meta => meta.level > 0);

    if (aliasMeta.level === 0 && partMatches.length === 0) return -Infinity;

    let score = 0;
    score += aliasMeta.level * 900;
    score += (entry.type === 'city' ? 180 : 80);
    if (entry.type === 'country' && (aliasMeta.exact || entry._nameDense === queryDense)) score += 2500;
    score -= entry.priority || 0;

    const cityPartDense = profile.denseWithoutCountries[0] || queryDense;
    const cityPartNorm = profile.denseWithoutCountries[0]
      ? normalizeText(profile.parts.find(part => denseText(part) === profile.denseWithoutCountries[0]) || profile.parts[0] || profile.raw)
      : queryNorm;
    const cityMeta = entry.type === 'city' ? cityNameMatchMeta(entry, cityPartNorm, cityPartDense) : { level: 0, exact: false, prefix: false };

    if (entry.type === 'city') {
      score += cityMeta.level * 1100;
      if (cityMeta.exact) score += 2600;
      if (cityMeta.prefix) score += 300;
      if (entry.isCapital) score += 60;
    } else {
      const countryMeta = cityNameMatchMeta(entry, queryNorm, queryDense);
      score += countryMeta.level * 700;
      if (countryMeta.exact) score += 2800;
    }

    if (aliasMeta.exact) score += 2200;
    if (aliasMeta.prefix) score += 260;

    if (profile.hasStructuredCountry) {
      if (entry.type === 'city') {
        if (profile.mentionedCountryCodes.has(entry.countryCode)) {
          score += 2200;
        } else {
          return -Infinity;
        }
      } else if (profile.mentionedCountryCodes.has(entry.code)) {
        score += 2000;
      } else {
        return -Infinity;
      }
    }

    if (profile.denseParts.length >= 2 && entry.type === 'city') {
      const allPartsMatch = profile.denseParts.every((part, idx) => {
        const partNorm = profile.parts[idx] || part;
        const m = aliasMatchMeta(entry, normalizeText(partNorm), part);
        return m.level >= 4 || entry._countryDense.includes(part);
      });
      if (allPartsMatch) score += 1200;
    }

    if (profile.denseParts.length === 1 && aliasMeta.level <= 2 && cityMeta.level <= 2) {
      score -= 1200;
    }

    const queryLooksExact = profile.denseParts.length === 1 && queryDense.length <= 8;
    if (queryLooksExact && entry.type === 'city' && cityMeta.level < 5 && aliasMeta.level < 5) {
      score -= 900;
    }

    score += preferredCountryBias(entry, profile);
    return score;
  }

  function dedupeResults(items) {
    const map = new Map();
    for (const item of items) {
      const key = [
        item.type,
        denseText(item.nameKo || item.nameEn || ''),
        denseText(item.countryKo || item.countryEn || ''),
        item.countryCode || '',
      ].join('|');
      const prev = map.get(key);
      if (!prev || (item._score || 0) > (prev._score || 0)) {
        map.set(key, item);
      }
    }
    return [...map.values()];
  }


  function keepBestPerExactHangulCity(items, profile) {
    if (!hasHangul(profile.raw) || profile.hasStructuredCountry || profile.denseParts.length !== 1) {
      return items;
    }

    const queryDense = profile.denseWithoutCountries[0] || profile.dense;
    const queryNorm = normalizeText(profile.parts[0] || profile.raw);
    const exactCityMatches = items.filter(item => item.type === 'city' && cityNameMatchMeta(item, queryNorm, queryDense).exact);
    if (!exactCityMatches.length) {
      return items;
    }

    const grouped = new Map();
    for (const item of exactCityMatches) {
      const key = item._nameDense || denseText(item.nameKo || item.nameEn || '');
      const prev = grouped.get(key);
      if (!prev || sortResults(item, prev) < 0) {
        grouped.set(key, item);
      }
    }

    const exactBest = [...grouped.values()].sort(sortResults);
    const exactNameKeys = new Set(exactBest.map(item => item._nameDense));
    const exactIdentityKeys = new Set(exactBest.map(item => [
      item.type,
      item._nameDense,
      item.countryCode || '',
      Math.round(Number(item.lat || 0) * 1000),
      Math.round(Number(item.lon || 0) * 1000),
    ].join('|')));

    const remainder = items.filter(item => {
      const key = item._nameDense || denseText(item.nameKo || item.nameEn || '');
      const identity = [
        item.type,
        key,
        item.countryCode || '',
        Math.round(Number(item.lat || 0) * 1000),
        Math.round(Number(item.lon || 0) * 1000),
      ].join('|');
      if (exactIdentityKeys.has(identity)) return false;
      return !exactNameKeys.has(key);
    });

    return [...exactBest, ...remainder];
  }

  function sortResults(a, b) {
    if ((b._score || 0) !== (a._score || 0)) return (b._score || 0) - (a._score || 0);
    if (a.type !== b.type) return a.type === 'city' ? -1 : 1;
    if (!!b.isCapital !== !!a.isCapital) return b.isCapital ? 1 : -1;
    return String(a.nameKo || a.nameEn || '').localeCompare(String(b.nameKo || b.nameEn || ''));
  }

  function searchLocal(query, options = {}) {
    const maxResults = options.maxResults || 10;
    const profile = getQueryProfile(query);
    if (!profile.dense) return [];

    let scored = allEntries
      .map(entry => ({ ...entry, _score: scoreEntry(entry, profile), source: 'LOCAL' }))
      .filter(entry => Number.isFinite(entry._score))
      .sort(sortResults);

    const queryDense = profile.denseWithoutCountries[0] || profile.dense;
    const queryNorm = normalizeText(profile.parts[0] || profile.raw);

    const exactCityMatches = scored.filter(item => item.type === 'city' && cityNameMatchMeta(item, queryNorm, queryDense).exact);
    const exactCountryMatches = scored.filter(item => item.type === 'country' && cityNameMatchMeta(item, profile.normalized, profile.dense).exact);

    if (exactCityMatches.length) {
      const exactNameSet = new Set(exactCityMatches.map(item => item._nameDense));
      scored = scored.filter(item => item.type === 'city' && exactNameSet.has(item._nameDense));
    } else if (exactCountryMatches.length) {
      const countrySet = new Set(exactCountryMatches.map(item => item.code));
      scored = scored.filter(item => item.type === 'country' && countrySet.has(item.code));
    } else if (profile.denseParts.length === 1) {
      const strong = scored.filter(item => {
        const aliasMeta = aliasMatchMeta(item, profile.normalized, profile.dense);
        const cityMeta = item.type === 'city' ? cityNameMatchMeta(item, profile.normalized, profile.dense) : { level: 0 };
        return aliasMeta.level >= 4 || cityMeta.level >= 4;
      });
      if (strong.length) scored = strong;
    }

    let finalResults = dedupeResults(scored).sort(sortResults);
    finalResults = keepBestPerExactHangulCity(finalResults, profile);
    return finalResults.slice(0, maxResults);
  }

  function inferCountryFromText(value) {
    const raw = String(value || '').trim();
    const dense = denseText(raw);
    if (!dense) return null;

    const upper = raw.toUpperCase().trim();
    if (countryCodeMap.has(upper)) {
      return countryCodeMap.get(upper);
    }
    if (countryAliasMap.has(dense)) {
      return countryAliasMap.get(dense);
    }

    const tokens = normalizeText(raw).split(/\s+/).filter(Boolean).map(denseText);
    if (tokens.length) {
      for (const token of tokens) {
        if (countryAliasMap.has(token)) {
          return countryAliasMap.get(token);
        }
      }
    }

    let best = null;
    let bestLength = 0;
    for (const [aliasDense, country] of countryAliasMap.entries()) {
      if (aliasDense.length < 3) continue;
      if (dense.includes(aliasDense) && aliasDense.length > bestLength) {
        best = country;
        bestLength = aliasDense.length;
      }
    }
    return best;
  }

  function queryCityNorm(profile) {
    const dense = profile.denseWithoutCountries[0] || profile.dense;
    const part = profile.parts.find(item => denseText(item) === dense) || profile.parts[0] || profile.raw;
    return { dense, norm: normalizeText(part) };
  }

  function isRemoteCandidateRelevant(mapped, profile) {
    const q = queryCityNorm(profile);
    const cityMeta = mapped.type === 'city' ? cityNameMatchMeta(mapped, q.norm, q.dense) : cityNameMatchMeta(mapped, profile.normalized, profile.dense);
    const aliasMeta = aliasMatchMeta(mapped, q.norm, q.dense);
    if (profile.hasStructuredCountry) {
      if (mapped.type === 'city' && !profile.mentionedCountryCodes.has(mapped.countryCode)) return false;
      if (mapped.type === 'country' && !profile.mentionedCountryCodes.has(mapped.code || mapped.countryCode)) return false;
    }
    if (profile.denseParts.length === 1) {
      return cityMeta.level >= 4 || aliasMeta.level >= 4;
    }
    return cityMeta.level >= 3 || aliasMeta.level >= 3;
  }

  function mapNominatimItem(item, queryProfile) {
    const addr = item.address || {};
    const lat = Number(item.lat);
    const lon = Number(item.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;

    const explicitCountry = inferCountryFromText(addr.country || '') || inferCountryFromText(item.display_name || '');
    const countryCode = explicitCountry?.code || String(addr.country_code || '').toUpperCase() || '';
    if (queryProfile.hasStructuredCountry && !queryProfile.mentionedCountryCodes.has(countryCode)) {
      return null;
    }

    const typeRaw = String(item.type || '').toLowerCase();
    const clsRaw = String(item.class || '').toLowerCase();
    const isCountry = typeRaw === 'country' || clsRaw === 'boundary';
    const mapped = tokenizeEntry({
      type: isCountry ? 'country' : 'city',
      nameKo: '',
      nameEn: item.name || addr.city || addr.town || addr.village || addr.state || addr.country || String(item.display_name || '').split(',')[0].trim(),
      countryKo: explicitCountry?.nameKo || '',
      countryEn: explicitCountry?.nameEn || addr.country || '',
      countryCode,
      lat,
      lon,
      zoom: isCountry ? 6 : 10,
      isCapital: false,
      priority: 120,
      aliases: [],
    });
    mapped._score = scoreEntry(mapped, queryProfile) - 120;
    if (!Number.isFinite(mapped._score) || !isRemoteCandidateRelevant(mapped, queryProfile)) return null;
    return mapped;
  }

  async function searchNominatim(query, queryProfile, limit = 8) {
    const url = 'https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&limit=' + encodeURIComponent(String(limit)) + '&accept-language=ko,en&q=' + encodeURIComponent(query);
    try {
      const response = await fetch(url, { headers: { Accept: 'application/json' } });
      if (!response.ok) return [];
      const data = await response.json();
      return (Array.isArray(data) ? data : []).map(item => mapNominatimItem(item, queryProfile)).filter(Boolean);
    } catch (error) {
      console.warn('Nominatim search failed:', error);
      return [];
    }
  }

  function mapArcGisCandidate(item, queryProfile) {
    const attrs = item.attributes || {};
    const loc = item.location || {};
    const lat = Number(loc.y);
    const lon = Number(loc.x);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    const explicitCountry = inferCountryFromText(attrs.Country || attrs.LongLabel || attrs.Match_addr || '');
    const countryCode = explicitCountry?.code || '';
    if (queryProfile.hasStructuredCountry && countryCode && !queryProfile.mentionedCountryCodes.has(countryCode)) {
      return null;
    }

    const isCountry = /country/i.test(String(attrs.Addr_type || '')) || /country/i.test(String(attrs.Type || ''));
    const mapped = tokenizeEntry({
      type: isCountry ? 'country' : 'city',
      nameKo: '',
      nameEn: attrs.City || attrs.PlaceName || attrs.Region || attrs.Country || attrs.LongLabel || attrs.Match_addr || '',
      countryKo: explicitCountry?.nameKo || '',
      countryEn: explicitCountry?.nameEn || attrs.Country || '',
      countryCode,
      lat,
      lon,
      zoom: isCountry ? 6 : 10,
      isCapital: false,
      priority: 130,
      aliases: [],
    });
    mapped._score = scoreEntry(mapped, queryProfile) - 150;
    if (!Number.isFinite(mapped._score) || !isRemoteCandidateRelevant(mapped, queryProfile)) return null;
    return mapped;
  }

  async function searchArcGis(query, queryProfile, limit = 8) {
    const url = 'https://geocode.arcgis.com/arcgis/rest/services/World/GeocodeServer/findAddressCandidates?f=json&maxLocations=' + encodeURIComponent(String(limit)) + '&langCode=KO&outFields=*&singleLine=' + encodeURIComponent(query);
    try {
      const response = await fetch(url, { headers: { Accept: 'application/json' } });
      if (!response.ok) return [];
      const data = await response.json();
      return (Array.isArray(data.candidates) ? data.candidates : []).map(item => mapArcGisCandidate(item, queryProfile)).filter(Boolean);
    } catch (error) {
      console.warn('ArcGIS geocode failed:', error);
      return [];
    }
  }

  async function searchPlaces(query, options = {}) {
    const maxResults = options.maxResults || 10;
    const profile = getQueryProfile(query);
    const localResults = searchLocal(query, { maxResults: Math.max(maxResults, 12) });

    const topLocalScore = localResults[0]?._score || 0;
    const topIsExactCity = !!localResults[0] && localResults[0].type === 'city' && cityNameMatchMeta(localResults[0], normalizeText(profile.parts[0] || profile.raw), profile.denseWithoutCountries[0] || profile.dense).exact;
    const hasStrongLocal = topLocalScore >= 5000 || topIsExactCity || localResults.length >= Math.min(5, maxResults);
    const needsRemote = options.forceRemote || (!hasStrongLocal && localResults.length < Math.min(4, maxResults));

    if (!needsRemote) {
      return localResults.slice(0, maxResults);
    }

    const [nominatimResults, arcgisResults] = await Promise.all([
      searchNominatim(query, profile, 6),
      searchArcGis(query, profile, 6),
    ]);

    let merged = dedupeResults([...localResults, ...nominatimResults, ...arcgisResults]).sort(sortResults);
    merged = keepBestPerExactHangulCity(merged, profile);

    const q = queryCityNorm(profile);
    const exactRemote = merged.filter(item => item.type === 'city' && cityNameMatchMeta(item, q.norm, q.dense).exact);
    if (exactRemote.length) {
      const exactNames = new Set(exactRemote.map(item => item._nameDense));
      merged = merged.filter(item => item.type === 'city' && exactNames.has(item._nameDense));
    } else if (profile.denseParts.length === 1) {
      const strongRemote = merged.filter(item => {
        const cm = item.type === 'city' ? cityNameMatchMeta(item, q.norm, q.dense) : cityNameMatchMeta(item, profile.normalized, profile.dense);
        const am = aliasMatchMeta(item, q.norm, q.dense);
        return cm.level >= 4 || am.level >= 4;
      });
      if (strongRemote.length) merged = strongRemote;
    }

    merged = keepBestPerExactHangulCity(merged.sort(sortResults), profile);
    return merged.slice(0, maxResults);
  }

  function getResultLabel(item) {
    const primary = item.nameKo || item.nameEn;
    const enName = item.nameKo && item.nameEn ? item.nameEn : '';
    const country = item.type === 'country'
      ? [item.nameKo && item.nameEn ? item.nameEn : '', item.code || item.countryCode].filter(Boolean).join(' · ')
      : [item.countryKo || item.countryEn, item.countryKo && item.countryEn ? item.countryEn : ''].filter(Boolean).join(' · ');

    return {
      primary,
      secondary: [enName, country].filter(Boolean).join(' · '),
    };
  }

  function getFlyToOptions(item) {
    if (item.type === 'country') return { altitude: 2400000, pitch: -90, zoom: 6 };
    if (item.isCapital) return { altitude: 95000, pitch: -90, zoom: 10 };
    if (item.zoom >= 11) return { altitude: 60000, pitch: -90, zoom: item.zoom };
    if (item.zoom >= 10) return { altitude: 85000, pitch: -90, zoom: item.zoom };
    return { altitude: 150000, pitch: -90, zoom: item.zoom || 10 };
  }

  function haversineKm(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  function findNearestCountry(lat, lon) {
    let best = null;
    let bestDistance = Infinity;
    for (const item of indexedCountries) {
      const dist = haversineKm(lat, lon, Number(item.lat), Number(item.lon));
      if (dist < bestDistance) {
        best = item;
        bestDistance = dist;
      }
    }
    return best;
  }

  function findNearestCityWithDistance(lat, lon, maxDistanceKm = 180, countryCode = '') {
    let best = null;
    let bestDistance = Infinity;
    for (const item of allCities) {
      if (countryCode && item.countryCode && item.countryCode !== countryCode) continue;
      const dist = haversineKm(lat, lon, Number(item.lat), Number(item.lon));
      if (dist < bestDistance) {
        best = item;
        bestDistance = dist;
      }
    }
    return bestDistance <= maxDistanceKm ? { item: best, distanceKm: bestDistance } : null;
  }

  function findNearestCity(lat, lon, maxDistanceKm = 180, countryCode = '') {
    const match = findNearestCityWithDistance(lat, lon, maxDistanceKm, countryCode);
    return match ? match.item : null;
  }


  const CITY_NAME_OVERRIDES = {
    'harbin': '하얼빈',
    'haerbin': '하얼빈',
    '哈尔滨': '하얼빈',
    'beijing': '베이징',
    '北京': '베이징',
    'shanghai': '상하이',
    '上海': '상하이',
    'guangzhou': '광저우',
    '广州': '광저우',
    'shenzhen': '선전',
    '深圳': '선전',
    'chengdu': '청두',
    '成都': '청두',
    'chongqing': '충칭',
    '重庆': '충칭',
    'nanjing': '난징',
    '南京': '난징',
    'wuhan': '우한',
    '武汉': '우한',
    'xian': '시안',
    "xi'an": '시안',
    '西安': '시안',
    'hangzhou': '항저우',
    '杭州': '항저우',
    'songyuan': '쑹위안',
    '松原': '쑹위안',
    'changchun': '창춘',
    '长春': '창춘',
    'shenyang': '선양',
    '沈阳': '선양',
    'qingdao': '칭다오',
    '青岛': '칭다오',
    'tianjin': '톈진',
    '天津': '톈진',
    'hongkong': '홍콩',
    'hong kong': '홍콩',
    '香港': '홍콩',
    'macau': '마카오',
    'macao': '마카오',
    '澳门': '마카오',
    'tokyo': '도쿄',
    '東京': '도쿄',
    'osaka': '오사카',
    '大阪': '오사카',
    'kyoto': '교토',
    '京都': '교토',
    'nagoya': '나고야',
    '名古屋': '나고야',
    'sapporo': '삿포로',
    '札幌': '삿포로',
    'fukuoka': '후쿠오카',
    '福岡': '후쿠오카',
    'taipei': '타이베이',
    '台北': '타이베이',
    'kaohsiung': '가오슝',
    '高雄': '가오슝',
    'taichung': '타이중',
    '台中': '타이중',
    'newyork': '뉴욕',
    'new york': '뉴욕',
    'losangeles': '로스앤젤레스',
    'los angeles': '로스앤젤레스',
    'sanfrancisco': '샌프란시스코',
    'san francisco': '샌프란시스코',
    'london': '런던',
    'paris': '파리',
    'rome': '로마',
    'madrid': '마드리드',
    'berlin': '베를린',
    'brussels': '브뤼셀',
    'amsterdam': '암스테르담',
    'vienna': '빈',
    'prague': '프라하',
    'budapest': '부다페스트',
    'warsaw': '바르샤바',
    'moscow': '모스크바',
    'beirut': '베이루트',
    'dubai': '두바이',
    'doha': '도하',
    'bangkok': '방콕',
    'hanoi': '하노이',
    'hochiminhcity': '호찌민시',
    'ho chi minh city': '호찌민시',
    'danang': '다낭',
    'singapore': '싱가포르',
    'jakarta': '자카르타',
    'manila': '마닐라',
    'sydney': '시드니',
    'melbourne': '멜버른',
    'auckland': '오클랜드',
    'cairo': '카이로',
    'johannesburg': '요하네스버그',
    'nairobi': '나이로비',
    'lagos': '라고스',
    'saopaulo': '상파울루',
    'sao paulo': '상파울루',
    'riodejaneiro': '리우데자네이루',
    'rio de janeiro': '리우데자네이루',
    'mexicocity': '멕시코시티',
    'mexico city': '멕시코시티',
    'toronto': '토론토',
    'vancouver': '밴쿠버'
  };



  Object.assign(CITY_NAME_OVERRIDES, {
    // Spain
    'malaga': '말라가',
    'zaragoza': '사라고사',
    'murcia': '무르시아',
    'palma': '팔마',
    'bilbao': '빌바오',
    'alicante': '알리칸테',
    'cordoba': '코르도바',
    'valladolid': '바야돌리드',
    'vigo': '비고',
    'gijon': '히혼',
    'granada': '그라나다',
    'a coruna': '아코루냐',
    'acoruna': '아코루냐',
    'vitoria gasteiz': '비토리아가스테이스',
    'vitoriagasteiz': '비토리아가스테이스',
    // France
    'toulouse': '툴루즈',
    'nantes': '낭트',
    'strasbourg': '스트라스부르',
    'montpellier': '몽펠리에',
    'bordeaux': '보르도',
    'lille': '릴',
    'rennes': '렌',
    'reims': '랭스',
    'le havre': '르아브르',
    'lehavre': '르아브르',
    'saint etienne': '생테티엔',
    'saintetienne': '생테티엔',
    'toulon': '툴롱',
    'grenoble': '그르노블',
    'dijon': '디종',
    'angers': '앙제',
    'nimes': '님',
    // Senegal
    'dakar': '다카르',
    'touba': '투바',
    'thies': '티에스',
    'thiès': '티에스',
    'kaolack': '카오라크',
    'ziguinchor': '지긴쇼르',
    'saint louis': '생루이',
    'saintlouis': '생루이',
    'mbour': '음부르',
    // Côte d'Ivoire
    'abidjan': '아비장',
    'yamoussoukro': '야무수크로',
    'bouake': '부아케',
    'bouaké': '부아케',
    'daloa': '달로아',
    'korhogo': '코로고',
    'san pedro': '상페드로',
    'sanpedro': '상페드로',
    'gagnoa': '가뇨아',
    // Sierra Leone
    'freetown': '프리타운',
    'bo': '보',
    'kenema': '케네마',
    'makeni': '마케니',
    'koidu': '코이두',
    // Ghana
    'accra': '아크라',
    'kumasi': '쿠마시',
    'tamale': '타말레',
    'sekondi takoradi': '세콘디타코라디',
    'sekonditakoradi': '세콘디타코라디',
    'cape coast': '케이프코스트',
    'capecoast': '케이프코스트',
    'tema': '테마',
    'sunyani': '수냐니',
    // South Sudan
    'juba': '주바',
    'wau': '와우',
    'malakal': '말라칼',
    'bor': '보르',
    'yei': '예이',
    'aweil': '아웨일',
    'yambio': '얌비오',
    'rumbek': '룸베크',
    // Sudan
    'khartoum': '하르툼',
    'omdurman': '옴두르만',
    'port sudan': '포트수단',
    'portsudan': '포트수단',
    'nyala': '니알라',
    'kassala': '카살라',
    'el obeid': '엘오베이드',
    'elobeid': '엘오베이드',
    'gedaref': '게다레프',
    // Türkiye
    'bursa': '부르사',
    'antalya': '안탈리아',
    'adana': '아다나',
    'gaziantep': '가지안테프',
    'konya': '코니아',
    'mersin': '메르신',
    'diyarbakir': '디야르바크르',
    'diyarbakır': '디야르바크르',
    'kayseri': '카이세리',
    'eskisehir': '에스키셰히르',
    'eskişehir': '에스키셰히르',
    'samsun': '삼순',
    'trabzon': '트라브존',
    // Czechia
    'brno': '브르노',
    'ostrava': '오스트라바',
    'plzen': '플젠',
    'plzeň': '플젠',
    'liberec': '리베레츠',
    'olomouc': '올로모우츠',
    // Slovakia
    'kosice': '코시체',
    'košice': '코시체',
    'zilina': '질리나',
    'žilina': '질리나',
    'presov': '프레쇼우',
    'prešov': '프레쇼우',
    'nitra': '니트라',
    'trnava': '트르나바',
    'banska bystrica': '반스카비스트리차',
    'banskabystrica': '반스카비스트리차'
  });

  function stripAdministrativeSuffix(value) {
    return String(value || '')
      .replace(/\s+/g, ' ')
      .replace(/\b(city|province|prefecture|district|county|state|region|metropolitan city|special city|special municipality)\b/gi, '')
      .replace(/(市|省|州|郡|縣|县|區|区|府|都|道)$/u, '')
      .trim();
  }

  function hasKorean(value) {
    return /[가-힣]/.test(String(value || ''));
  }

  function hasCjk(value) {
    return /[\u3400-\u9FFF\uF900-\uFAFF\u3040-\u30FF]/u.test(String(value || ''));
  }

  function normalizeLoose(value) {
    return normalizeText(stripAdministrativeSuffix(value)).replace(/[^a-z0-9가-힣]/g, '');
  }

  function getCityDisplayName(cityItem, fallbackName) {
    return String((cityItem && (cityItem.nameKo || cityItem.nameEn)) || fallbackName || '').trim();
  }

  function appendLocalizedCitySuffix(name, countryCode) {
    const value = String(name || '').trim();
    if (!value) return '';
    if (/(시|군|구|현|주|성|도|광역시|특별시|자치시|자치주)$/u.test(value)) return value;
    if (['CN', 'TW'].includes(countryCode)) return value + ' 시';
    return value;
  }

  function matchCityByName(rawName, countryCode) {
    const normalized = normalizeLoose(rawName);
    if (!normalized) return null;
    let best = null;
    let bestScore = -1;
    for (const item of allCities) {
      if (countryCode && item.countryCode && item.countryCode !== countryCode) continue;
      const candidates = [item.nameKo, item.nameEn].concat(item.aliases || []).filter(Boolean);
      for (const candidate of candidates) {
        const dense = normalizeLoose(candidate);
        if (!dense) continue;
        let score = -1;
        if (dense === normalized) score = 300;
        else if (dense.startsWith(normalized) || normalized.startsWith(dense)) score = 220;
        else if (dense.includes(normalized) || normalized.includes(dense)) score = 150;
        if (score > bestScore) {
          best = item;
          bestScore = score;
        }
      }
    }
    return bestScore >= 150 ? best : null;
  }

  function firstKoreanCandidate(values) {
    for (const value of values || []) {
      const text = String(value || '').trim();
      if (text && hasKorean(text)) return text;
    }
    return '';
  }

  function localizeCityName(rawName, countryCode, lat, lon, extraNames = []) {
    const candidates = uniqueStrings([rawName, ...(Array.isArray(extraNames) ? extraNames : [])].filter(Boolean));
    const directKorean = firstKoreanCandidate(candidates);
    if (directKorean) return appendLocalizedCitySuffix(directKorean, countryCode || '');

    for (const candidate of candidates) {
      const byName = matchCityByName(candidate, countryCode);
      if (byName) return appendLocalizedCitySuffix(getCityDisplayName(byName, candidate), countryCode || byName.countryCode || '');
    }

    for (const candidate of candidates) {
      const overrideKey = normalizeLoose(candidate);
      if (CITY_NAME_OVERRIDES[overrideKey]) return appendLocalizedCitySuffix(CITY_NAME_OVERRIDES[overrideKey], countryCode || '');
    }

    if (typeof lat === 'number' && typeof lon === 'number') {
      const nearestTightMatch = findNearestCityWithDistance(lat, lon, 45, countryCode || '');
      if (nearestTightMatch && nearestTightMatch.item) {
        return appendLocalizedCitySuffix(getCityDisplayName(nearestTightMatch.item, rawName), countryCode || nearestTightMatch.item.countryCode || '');
      }
    }

    for (const candidate of candidates) {
      const value = String(candidate || '').trim();
      if (!value) continue;
      if (hasCjk(value) && ['CN', 'TW', 'JP', 'HK', 'MO'].includes(countryCode)) {
        const stripped = stripAdministrativeSuffix(value);
        const override = CITY_NAME_OVERRIDES[normalizeLoose(stripped)] || CITY_NAME_OVERRIDES[normalizeLoose(value)];
        if (override) return appendLocalizedCitySuffix(override, countryCode);
      }
    }

    if (typeof lat === 'number' && typeof lon === 'number') {
      const nearestMatch = findNearestCityWithDistance(lat, lon, 120, countryCode || '');
      if (nearestMatch && nearestMatch.item) {
        return appendLocalizedCitySuffix(getCityDisplayName(nearestMatch.item, rawName), countryCode || nearestMatch.item.countryCode || '');
      }
    }

    const fallback = String(rawName || candidates[0] || '').trim();
    return appendLocalizedCitySuffix(fallback, countryCode || '');
  }

  const reverseCache = new Map();

  function makeReverseLabel(countryName, cityName) {
    const country = String(countryName || '').trim();
    const city = String(cityName || '').trim();
    if (country && city) return country + ' - ' + city;
    return country || city || '위치 확인 중...';
  }


  async function reverseFromArcGis(lat, lon) {
    const url = 'https://geocode.arcgis.com/arcgis/rest/services/World/GeocodeServer/reverseGeocode?f=json&langCode=KO&location=' + encodeURIComponent(lon + ',' + lat);
    const response = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error('ArcGIS reverse geocode failed');
    const data = await response.json();
    const addr = data.address || {};
    const country = inferCountryFromText(addr.CountryCode || addr.Country || '') || inferCountryFromText(addr.LongLabel || '') || null;
    const countryCode = country ? country.code : '';
    const countryName = country ? (country.nameKo || country.nameEn) : (addr.Country || addr.CountryCode || '');
    const cityCandidates = uniqueStrings([
      addr.City,
      addr.District,
      addr.Subregion,
      addr.Region,
      addr.MetroArea,
      addr.Neighborhood,
      addr.LongLabel ? String(addr.LongLabel).split(',')[0].trim() : '',
    ].filter(Boolean));
    const cityRaw = cityCandidates[0] || '';
    const cityName = localizeCityName(cityRaw, countryCode, lat, lon, cityCandidates.slice(1));
    return { country: countryName, city: cityName, countryCode, label: makeReverseLabel(countryName, cityName) };
  }


  async function reverseFromNominatim(lat, lon) {
    const url = 'https://nominatim.openstreetmap.org/reverse?format=jsonv2&addressdetails=1&accept-language=ko,en&namedetails=1&lat=' + encodeURIComponent(String(lat)) + '&lon=' + encodeURIComponent(String(lon));
    const response = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error('Nominatim reverse geocode failed');
    const data = await response.json();
    const addr = data.address || {};
    const names = data.namedetails || {};
    const country = inferCountryFromText(addr.country_code || '') || inferCountryFromText(addr.country || '') || null;
    const countryCode = country ? country.code : '';
    const countryName = country ? (country.nameKo || country.nameEn) : (addr.country || '');
    const displayFirst = data.display_name ? String(data.display_name).split(',')[0].trim() : '';
    const cityCandidates = uniqueStrings([
      names['name:ko'],
      names['official_name:ko'],
      names['short_name:ko'],
      addr.city,
      addr.town,
      addr.village,
      addr.municipality,
      addr.city_district,
      addr.suburb,
      addr.state_district,
      addr.county,
      addr.state,
      names.name,
      displayFirst,
    ].filter(Boolean));
    const cityRaw = cityCandidates[0] || '';
    const cityName = localizeCityName(cityRaw, countryCode, lat, lon, cityCandidates.slice(1));
    return { country: countryName, city: cityName, countryCode, label: makeReverseLabel(countryName, cityName) };
  }

  async function reverseGeocode(lat, lon) {
    const key = lat.toFixed(2) + ',' + lon.toFixed(2);
    if (reverseCache.has(key)) return reverseCache.get(key);

    const nearestCountry = findNearestCountry(lat, lon);
    const fallbackCountryCode = nearestCountry?.code || '';
    const nearestCity = findNearestCity(lat, lon, 120, fallbackCountryCode);
    const fallback = {
      country: nearestCountry ? (nearestCountry.nameKo || nearestCountry.nameEn) : '',
      city: nearestCity ? (nearestCity.nameKo || nearestCity.nameEn) : '',
      countryCode: fallbackCountryCode,
      label: makeReverseLabel(nearestCountry ? (nearestCountry.nameKo || nearestCountry.nameEn) : '', nearestCity ? (nearestCity.nameKo || nearestCity.nameEn) : ''),
    };

    try {
      const result = await reverseFromNominatim(lat, lon);
      reverseCache.set(key, result);
      return result;
    } catch (error) {
      try {
        const result = await reverseFromArcGis(lat, lon);
        reverseCache.set(key, result);
        return result;
      } catch (nestedError) {
        reverseCache.set(key, fallback);
        return fallback;
      }
    }
  }

  window.WorldSearch = {
    countries: indexedCountries,
    cities: allCities,
    normalizeText,
    denseText,
    searchLocal,
    searchPlaces,
    getResultLabel,
    getFlyToOptions,
    reverseGeocode,
  };
}());
