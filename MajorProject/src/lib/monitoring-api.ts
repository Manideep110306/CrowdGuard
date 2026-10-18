export type Camera = {
  id: string;
  name: string;
  sourceType: 'Webcam' | 'Video' | 'CCTV / RTSP';
  location: string;
  source: string;
  status: 'Online' | 'Standby';
};

export type CameraDraft = Pick<Camera, 'name' | 'sourceType' | 'source' | 'location'>;

// ============================================================
// USER-DEFINED MONITORING ZONES
// ============================================================

export type ZonePoint = {
  x: number;
  y: number;
};

export type CameraZoneConfig = {
  id: string;
  name: string;
  points: ZonePoint[];
  capacity: number;
  warning_threshold: number;
  critical_threshold: number;
  enabled: boolean;
};
export type BackendStatus = {
  total_people: number;
  zones: Record<string, { people: number; capacity: number; occupancy: number; status: string }>;
  camera_id: string;
};

export type Zone = {
  id: string;
  name: string;
  people: number;
  capacity: number;
  warning: number;
  critical: number;
  enabled: boolean;
};

export type SafetyAlert = {
  id: string;
  severity: 'Critical' | 'Warning';
  zone: string;
  people: number;
  capacity: number;
  occupancy: number;
  time: string;
  status: 'Active' | 'Acknowledged' | 'Resolved';
  history: string[];
};

export type ServiceHealth = { online: boolean; message?: string };

const API_URL = (import.meta.env['VITE_API_URL'] || 'http://127.0.0.1:5000').replace(/\/$/, '');
const SESSION_KEY = 'crowdguard.auth.session';

type ApiPayload = Record<string, unknown> | null;

function getAuthToken(): string | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const session = JSON.parse(raw) as { token?: unknown };
    return typeof session.token === 'string' && session.token.trim()
      ? session.token
      : null;
  } catch {
    return null;
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);

  try {
    const headers = new Headers(init.headers);
    headers.set('Accept', 'application/json');

    if (init.body && !headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json');
    }

    const token = getAuthToken();
    if (token && !headers.has('Authorization')) {
      headers.set('Authorization', `Bearer ${token}`);
    }

    const response = await fetch(`${API_URL}${path}`, {
      ...init,
      headers,
      signal: controller.signal,
    });

    const payload = await response.json().catch(() => null) as ApiPayload;

    if (!response.ok) {
      const message = String(
        payload?.['error'] ??
        payload?.['message'] ??
        `Request failed (${response.status})`,
      );

      if (response.status === 401) {
        throw new Error('Your session is missing or expired. Please sign in again.');
      }

      throw new Error(message);
    }

    return payload as T;
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error('Request timed out. Check the Flask service and retry.');
    }
    if (error instanceof TypeError) {
      throw new Error(`Backend unavailable. Check that Flask is running at ${API_URL}.`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function toBackendSourceType(sourceType: Camera['sourceType']): 'webcam' | 'video' | 'rtsp' {
  if (sourceType === 'Webcam') return 'webcam';
  if (sourceType === 'Video') return 'video';
  return 'rtsp';
}

function normalizeCamera(raw: Record<string, unknown>): Camera {
  const sourceType = raw['source_type'] === 'webcam'
    ? 'Webcam'
    : raw['source_type'] === 'video'
      ? 'Video'
      : 'CCTV / RTSP';

  return {
    id: String(raw['id'] ?? raw['_id'] ?? raw['camera_id'] ?? ''),
    name: String(raw['name'] ?? ''),
    sourceType,
    source: String(raw['source'] ?? ''),
    location: String(raw['location'] ?? ''),
    status: raw['status'] === 'active' ? 'Online' : 'Standby',
  };
}

function cameraToRequestBody(camera: CameraDraft) {
  const enteredSource = camera.source.trim();
  return {
    name: camera.name.trim(),
    source_type: toBackendSourceType(camera.sourceType),
    // OpenCV's default local webcam device is 0; allow the field to be blank for webcams.
    source: camera.sourceType === 'Webcam' && !enteredSource ? '0' : enteredSource,
    location: camera.location.trim(),
  };
}

function cameraFromResponse(payload: Record<string, unknown>): Camera {
  const rawCamera = payload['camera'];
  const camera = (rawCamera && typeof rawCamera === 'object'
    ? rawCamera
    : payload) as Record<string, unknown>;
  const normalized = normalizeCamera(camera);
  if (!normalized.id) {
    throw new Error('Camera response did not include the backend camera ID.');
  }
  return normalized;
}

export const monitoringApi = {
    health: async (): Promise<ServiceHealth> => {
    const result = await request<Record<string, unknown>>('/api/health');
    const message = result['message'];

    return {
      online: result['backend'] === 'online',
      ...(typeof message === 'string' ? { message } : {}),
    };
  },

  cameras: async (): Promise<Camera[]> => {
    const result = await request<unknown>('/api/cameras');
    const list = Array.isArray(result)
      ? result
      : (result as { cameras?: unknown[] } | null)?.cameras;

    if (!Array.isArray(list)) {
      throw new Error('Unexpected camera response from Flask.');
    }

    return list.map((item) => normalizeCamera(item as Record<string, unknown>));
  },

  createCamera: async (camera: CameraDraft): Promise<Camera> => {
    const payload = await request<Record<string, unknown>>('/api/cameras', {
      method: 'POST',
      body: JSON.stringify(cameraToRequestBody(camera)),
    });
    return cameraFromResponse(payload);
  },

  updateCamera: async (cameraId: string, camera: CameraDraft): Promise<Camera> => {
    const payload = await request<Record<string, unknown>>(
      `/api/cameras/${encodeURIComponent(cameraId)}`,
      {
        method: 'PUT',
        body: JSON.stringify(cameraToRequestBody(camera)),
      },
    );
    return cameraFromResponse(payload);
  },

  deleteCamera: async (cameraId: string): Promise<void> => {
    await request<Record<string, unknown>>(
      `/api/cameras/${encodeURIComponent(cameraId)}`,
      { method: 'DELETE' },
    );
  },

  start: (cameraId: string) => request<Record<string, unknown>>(
    `/api/cameras/${encodeURIComponent(cameraId)}/start`,
    { method: 'POST' },
  ),

  stop: (cameraId: string) => request<Record<string, unknown>>(
    `/api/cameras/${encodeURIComponent(cameraId)}/stop`,
    { method: 'POST' },
  ),

    monitoring: (cameraId: string) => request<BackendStatus>(
    `/api/monitoring/status/${encodeURIComponent(cameraId)}`,
  ),

  // ==========================================================
  // GET SAVED ZONES FOR A CAMERA
  // ==========================================================

  zones: async (
    cameraId: string,
  ): Promise<CameraZoneConfig[]> => {
    const result = await request<{
      camera_id: string;
      zones: CameraZoneConfig[];
      using_default_zones?: boolean;
    }>(
      `/api/cameras/${encodeURIComponent(cameraId)}/zones`,
    );

    if (!Array.isArray(result.zones)) {
      throw new Error(
        'Invalid zone configuration received from Flask.',
      );
    }

    return result.zones;
  },

  // ==========================================================
  // SAVE ZONES FOR A CAMERA
  // ==========================================================

  saveZones: async (
    cameraId: string,
    zones: CameraZoneConfig[],
  ): Promise<CameraZoneConfig[]> => {
    const result = await request<{
      message: string;
      camera_id: string;
      zones: CameraZoneConfig[];
    }>(
      `/api/cameras/${encodeURIComponent(cameraId)}/zones`,
      {
        method: 'PUT',
        body: JSON.stringify({ zones }),
      },
    );

    if (!Array.isArray(result.zones)) {
      throw new Error(
        'The server did not return the saved zone configuration.',
      );
    }

    return result.zones;
  },
};

export const zoneStatus = (zone: Zone) => {
  if (!zone.enabled) return 'Disabled';
  const occupancy = zone.capacity > 0 ? (zone.people / zone.capacity) * 100 : 0;
  return occupancy >= zone.critical
    ? 'Critical'
    : occupancy >= zone.warning
      ? 'Warning'
      : 'Normal';
};
