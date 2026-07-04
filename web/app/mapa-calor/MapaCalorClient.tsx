'use client';
import { useEffect, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { NavShell } from '../components/NavShell';

type Granularidade = 'zona' | 'bairro';
type Camada = 'forca' | 'potencial' | 'penetracao';

type AreaCalor = {
  area_id: string;
  area_nome: string;
  forca: number;
  potencial: number;
  penetracao: number | null;
  ponto_geojson: { type: 'Point'; coordinates: [number, number] } | null;
};

const CORES: Record<Camada, string> = {
  forca: '#2563eb',
  potencial: '#16a34a',
  penetracao: '#dc2626',
};

export function MapaCalorClient() {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const [granularidade, setGranularidade] = useState<Granularidade>('zona');
  const [camada, setCamada] = useState<Camada>('forca');
  const [areas, setAreas] = useState<AreaCalor[]>([]);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    let cancelado = false;
    setErro(null);
    fetch(`/api/mapa-calor?granularidade=${granularidade}`)
      .then((res) => {
        if (!res.ok) throw new Error('falha ao carregar mapa de calor');
        return res.json();
      })
      .then((data: AreaCalor[]) => {
        if (!cancelado) setAreas(data);
      })
      .catch(() => {
        if (!cancelado) {
          setErro('Não foi possível carregar os dados do mapa.');
          setAreas([]);
        }
      });
    return () => {
      cancelado = true;
    };
  }, [granularidade]);

  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;
    mapRef.current = new maplibregl.Map({
      container: mapContainerRef.current,
      style: {
        version: 8,
        sources: {
          osm: {
            type: 'raster',
            tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
            tileSize: 256,
            attribution: '© OpenStreetMap contributors',
          },
        },
        layers: [{ id: 'osm', type: 'raster', source: 'osm' }],
      },
      center: [-42.8034, -5.0892],
      zoom: 11,
    });
    return () => {
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const markers: maplibregl.Marker[] = [];
    for (const area of areas) {
      if (!area.ponto_geojson) continue;
      const valor = area[camada];
      const el = document.createElement('div');
      el.style.width = '16px';
      el.style.height = '16px';
      el.style.borderRadius = '50%';
      el.style.background = CORES[camada];
      el.style.opacity = valor === null ? '0.2' : '1';

      const content = document.createElement('div');
      const nome = document.createElement('strong');
      nome.textContent = area.area_nome;
      content.append(
        nome,
        document.createElement('br'),
        `Força: ${area.forca}`,
        document.createElement('br'),
        `Potencial: ${area.potencial}`,
        document.createElement('br'),
        `Penetração: ${area.penetracao ?? 'sem dado'}`,
      );
      const popup = new maplibregl.Popup({ offset: 12 }).setDOMContent(content);

      markers.push(
        new maplibregl.Marker({ element: el })
          .setLngLat(area.ponto_geojson.coordinates)
          .setPopup(popup)
          .addTo(map),
      );
    }
    return () => {
      for (const m of markers) m.remove();
    };
  }, [areas, camada]);

  return (
    <NavShell>
      <div>
        <div>
          <label>
            Granularidade:
            <select
              value={granularidade}
              onChange={(e) => setGranularidade(e.target.value as Granularidade)}
            >
              <option value="zona">Zona</option>
              <option value="bairro">Bairro</option>
            </select>
          </label>
          <label>
            Camada:
            <select value={camada} onChange={(e) => setCamada(e.target.value as Camada)}>
              <option value="forca">Força</option>
              <option value="potencial">Potencial</option>
              <option value="penetracao">Penetração</option>
            </select>
          </label>
        </div>
        {erro && <p role="alert">{erro}</p>}
        <div ref={mapContainerRef} style={{ width: '100%', height: '600px' }} />
      </div>
    </NavShell>
  );
}
