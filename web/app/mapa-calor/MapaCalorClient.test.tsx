// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';

vi.mock('maplibre-gl/dist/maplibre-gl.css', () => ({}));

const { MockMap, MockMarker, MockPopup } = vi.hoisted(() => {
  class MockMap {
    on() {}
    remove() {}
  }
  class MockMarker {
    setLngLat() { return this; }
    setPopup() { return this; }
    addTo() { return this; }
    remove() {}
  }
  class MockPopup {
    setHTML() { return this; }
    setDOMContent() { return this; }
  }
  return { MockMap, MockMarker, MockPopup };
});
vi.mock('maplibre-gl', () => ({
  default: { Map: MockMap, Marker: MockMarker, Popup: MockPopup },
}));

const mockAreas = [
  { area_id: 'zona-1', area_nome: '1', forca: 10, potencial: 100, penetracao: 0.1, ponto_geojson: { type: 'Point', coordinates: [-42.8, -5.09] } },
];

import { MapaCalorClient } from './MapaCalorClient';

describe('MapaCalorClient', () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => mockAreas,
    })) as never;
  });

  afterEach(() => {
    cleanup();
  });

  it('busca dados com granularidade=zona por padrão', async () => {
    render(<MapaCalorClient />);
    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith('/api/mapa-calor?granularidade=zona');
    });
  });

  it('troca granularidade e refaz o fetch com bairro', async () => {
    render(<MapaCalorClient />);
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    fireEvent.change(screen.getByLabelText(/granularidade/i), { target: { value: 'bairro' } });
    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith('/api/mapa-calor?granularidade=bairro');
    });
  });

  it('trocar camada NÃO refaz o fetch (dado já veio todo de uma vez)', async () => {
    render(<MapaCalorClient />);
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    fireEvent.change(screen.getByLabelText(/camada/i), { target: { value: 'potencial' } });
    await new Promise((r) => setTimeout(r, 10));
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('mostra erro quando o fetch falha', async () => {
    globalThis.fetch = vi.fn(async () => ({ ok: false, json: async () => ({}) })) as never;
    render(<MapaCalorClient />);
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/não foi possível/i);
    });
  });
});
