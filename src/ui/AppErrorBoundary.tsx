import React from 'react';
import { useAppStore } from '../app/store';
import { downloadText, sceneFilename } from '../scene/files';

export class AppErrorBoundary extends React.Component<{ children: React.ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    if (!this.state.failed) return this.props.children;
    return <main className="graphics-fallback" role="alert">
      <h1>FieldLab could not display this scene</h1>
      <p>Your scene is still available for export. Save a copy before reloading the editor.</p>
      <button className="btn" onClick={() => {
        const scene = useAppStore.getState().scene;
        downloadText(JSON.stringify(scene, null, 2), sceneFilename(scene.name));
      }}>Export current scene</button>
      <button className="btn btn-primary" onClick={() => window.location.reload()}>Reload editor</button>
    </main>;
  }
}
