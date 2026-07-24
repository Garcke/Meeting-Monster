import {createRoot} from 'react-dom/client';
import {CapsuleApp} from '../capsule/CapsuleApp';
import {PanelApp} from '../panel/PanelApp';
import './overlay.css';

export function OverlayApp() {
    return (
        <div className="overlay-root" data-react-root>
            <div className="capsule-layer">
                <CapsuleApp />
            </div>
            <div className="panel-layer">
                <PanelApp />
            </div>
        </div>
    );
}

const rootElement = document.getElementById('root');
if (rootElement) createRoot(rootElement).render(<OverlayApp />);
