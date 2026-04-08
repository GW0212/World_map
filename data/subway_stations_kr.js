(function () {
  'use strict';

  if (!Array.isArray(window.KR_SUBWAY_STATIONS)) {
    window.KR_SUBWAY_STATIONS = [];
  }

  window.setKrSubwayStations = function setKrSubwayStations(stations) {
    window.KR_SUBWAY_STATIONS = Array.isArray(stations) ? stations : [];
    return window.KR_SUBWAY_STATIONS;
  };
}());
