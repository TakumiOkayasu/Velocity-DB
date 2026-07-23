import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const addConnectionMock = vi.fn().mockResolvedValue({});
const cancelConnectionMock = vi.fn();

type MockConnection = { id: string; name: string; isActive: boolean };

const mockState: { connections: MockConnection[] } = { connections: [] };

vi.mock('../../../store/connectionStore', () => {
  const useConnectionStore = (
    selector?: (s: { connections: MockConnection[]; profileVersion: number }) => unknown
  ) => (selector ? selector({ connections: mockState.connections, profileVersion: 0 }) : null);
  (useConnectionStore as unknown as { getState: () => unknown }).getState = () => ({
    connections: mockState.connections,
    activeConnectionId: null,
    setTableListLoadTime: vi.fn(),
    setTableOpenTime: vi.fn(),
  });
  return {
    useConnectionStore,
    useConnectionActions: () => ({
      addConnection: addConnectionMock,
      cancelConnection: cancelConnectionMock,
    }),
  };
});

vi.mock('../../../store/connectionMigration', () => ({
  applyConnectionMigration: vi.fn(),
}));

vi.mock('../../../api/providers', () => ({
  connectionProfileProvider: {
    getConnectionProfiles: vi.fn(),
    getProfilePassword: vi.fn().mockResolvedValue({ password: '' }),
    getSshPassword: vi.fn().mockResolvedValue({ password: '' }),
    getSshKeyPassphrase: vi.fn().mockResolvedValue({ passphrase: '' }),
  },
  schemaProvider: {
    getTables: vi.fn().mockResolvedValue({ tables: [], loadTimeMs: 0 }),
    getColumns: vi.fn().mockResolvedValue([]),
  },
}));

import { connectionProfileProvider as bridge } from '../../../api/providers';
import { ObjectTree } from '../../../components/tree/ObjectTree';

type ProfileFixture = Awaited<ReturnType<typeof bridge.getConnectionProfiles>>['profiles'][number];

const buildProfile = (id: string, name: string, folderPath?: string): ProfileFixture => ({
  id,
  name,
  server: '127.0.0.1',
  port: 1433,
  database: 'db',
  username: 'sa',
  useWindowsAuth: false,
  savePassword: false,
  isProduction: false,
  isReadOnly: false,
  environment: 'development',
  dbType: 'sqlserver',
  ...(folderPath === undefined ? {} : { folderPath }),
});

const setProfiles = (profiles: ProfileFixture[]) => {
  vi.mocked(bridge.getConnectionProfiles).mockResolvedValue({ profiles });
};

const getFolderPaths = () =>
  screen.queryAllByTestId('folder-node').map((el) => el.dataset.folderPath ?? '');

describe('ObjectTree folder grouping', () => {
  beforeEach(() => {
    mockState.connections = [];
    addConnectionMock.mockClear();
    cancelConnectionMock.mockClear();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('renders folder nodes for each distinct folderPath preserving first-appearance order', async () => {
    setProfiles([
      buildProfile('p1', 'Alpha'),
      buildProfile('p2', 'WorkA', 'Work'),
      buildProfile('p3', 'Beta'),
      buildProfile('p4', 'WorkB', 'Work'),
      buildProfile('p5', 'Home1', 'Personal'),
    ]);

    render(<ObjectTree filter="" />);

    await waitFor(() => {
      expect(screen.getAllByTestId('profile-node')).toHaveLength(5);
    });

    expect(getFolderPaths()).toEqual(['Work', 'Personal']);
  });

  it('does not render a folder node when all profiles are at root', async () => {
    setProfiles([buildProfile('p1', 'Alpha'), buildProfile('p2', 'Beta')]);

    render(<ObjectTree filter="" />);

    await waitFor(() => {
      expect(screen.getAllByTestId('profile-node')).toHaveLength(2);
    });

    expect(getFolderPaths()).toEqual([]);
  });

  it('hides inner profiles when folder is collapsed via click', async () => {
    setProfiles([buildProfile('p1', 'WorkA', 'Work'), buildProfile('p2', 'WorkB', 'Work')]);

    render(<ObjectTree filter="" />);

    await waitFor(() => {
      expect(screen.getAllByTestId('profile-node')).toHaveLength(2);
    });

    const folder = screen.getByTestId('folder-node');
    const header = folder.querySelector('[title="Work"]');
    expect(header).not.toBeNull();
    if (header) fireEvent.click(header);

    await waitFor(() => {
      expect(screen.queryAllByTestId('profile-node')).toHaveLength(0);
    });
  });

  it('preserves profile order within a folder', async () => {
    setProfiles([
      buildProfile('p1', 'Third', 'Work'),
      buildProfile('p2', 'First', 'Work'),
      buildProfile('p3', 'Second', 'Work'),
    ]);

    render(<ObjectTree filter="" />);

    await waitFor(() => {
      expect(screen.getAllByTestId('profile-node')).toHaveLength(3);
    });

    const names = screen.getAllByTestId('profile-node').map((el) => el.dataset.profileName ?? '');
    expect(names).toEqual(['Third', 'First', 'Second']);
  });

  it('renders nested folders inside their parent with full data-folder-path', async () => {
    setProfiles([
      buildProfile('p1', 'Parent', 'Work'),
      buildProfile('p2', 'Child', 'Work/ProjectA'),
    ]);

    render(<ObjectTree filter="" />);

    await waitFor(() => {
      expect(screen.getAllByTestId('profile-node')).toHaveLength(2);
    });

    expect(getFolderPaths()).toEqual(['Work', 'Work/ProjectA']);

    const work = screen
      .getAllByTestId('folder-node')
      .find((el) => el.dataset.folderPath === 'Work');
    expect(work).toBeDefined();
    const nested = work?.querySelector('[data-folder-path="Work/ProjectA"]');
    expect(nested).not.toBeNull();
  });

  it('shows only the leaf segment as label while title keeps the full path', async () => {
    setProfiles([buildProfile('p1', 'Child', 'Work/ProjectA')]);

    render(<ObjectTree filter="" />);

    await waitFor(() => {
      expect(screen.getAllByTestId('profile-node')).toHaveLength(1);
    });

    const nestedHeader = screen.getByTitle('Work/ProjectA');
    expect(nestedHeader.textContent).toContain('ProjectA');
    expect(nestedHeader.textContent).not.toContain('Work/ProjectA');
    expect(screen.getByTitle('Work')).toBeDefined();
  });

  it('creates intermediate folder nodes for ancestors without direct profiles', async () => {
    setProfiles([buildProfile('p1', 'Deep', 'A/B/C')]);

    render(<ObjectTree filter="" />);

    await waitFor(() => {
      expect(screen.getAllByTestId('profile-node')).toHaveLength(1);
    });

    expect(getFolderPaths()).toEqual(['A', 'A/B', 'A/B/C']);
  });

  it('collapsing a parent hides descendant folders and profiles', async () => {
    setProfiles([
      buildProfile('p1', 'Parent', 'Work'),
      buildProfile('p2', 'Child', 'Work/ProjectA'),
      buildProfile('p3', 'Root', undefined),
    ]);

    render(<ObjectTree filter="" />);

    await waitFor(() => {
      expect(screen.getAllByTestId('profile-node')).toHaveLength(3);
    });

    fireEvent.click(screen.getByTitle('Work'));

    await waitFor(() => {
      // Only the root profile stays visible.
      expect(screen.getAllByTestId('profile-node')).toHaveLength(1);
    });
    expect(getFolderPaths()).toEqual(['Work']);
    expect(screen.queryByTitle('Work/ProjectA')).toBeNull();
  });

  it('shows descendant-inclusive profile count on parent folders', async () => {
    setProfiles([
      buildProfile('p1', 'Parent', 'Work'),
      buildProfile('p2', 'ChildA', 'Work/ProjectA'),
      buildProfile('p3', 'ChildB', 'Work/ProjectA'),
    ]);

    render(<ObjectTree filter="" />);

    await waitFor(() => {
      expect(screen.getAllByTestId('profile-node')).toHaveLength(3);
    });

    expect(screen.getByTitle('Work').textContent).toContain('(3)');
    expect(screen.getByTitle('Work/ProjectA').textContent).toContain('(2)');
  });

  it('indents nested folder headers progressively', async () => {
    setProfiles([buildProfile('p1', 'Deep', 'A/B')]);

    render(<ObjectTree filter="" />);

    await waitFor(() => {
      expect(screen.getAllByTestId('profile-node')).toHaveLength(1);
    });

    const outer = Number.parseInt(screen.getByTitle('A').style.paddingLeft, 10);
    const inner = Number.parseInt(screen.getByTitle('A/B').style.paddingLeft, 10);
    expect(inner).toBeGreaterThan(outer);
  });

  it('caps rendering depth at 5 folder levels', async () => {
    setProfiles([buildProfile('p1', 'Deep', 'a/b/c/d/e/f/g')]);

    render(<ObjectTree filter="" />);

    await waitFor(() => {
      expect(screen.getAllByTestId('profile-node')).toHaveLength(1);
    });

    expect(getFolderPaths()).toEqual(['a', 'a/b', 'a/b/c', 'a/b/c/d', 'a/b/c/d/e']);
  });
});
