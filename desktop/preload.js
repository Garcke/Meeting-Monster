'use strict';

const {contextBridge, ipcRenderer} = require('electron');

contextBridge.exposeInMainWorld('monsterOfferPrivacy', {
    getStatus: () => ipcRenderer.invoke('privacy:get-status'),
    setRedacted: (enabled) => ipcRenderer.invoke('privacy:set-redacted', Boolean(enabled)),
    getPolicy: () => ipcRenderer.invoke('privacy:get-policy'),
    onStatus: (callback) => {
        if (typeof callback !== 'function') {
            throw new TypeError('privacy status callback must be a function');
        }
        const listener = (_event, status) => callback(status);
        ipcRenderer.on('privacy:status', listener);
        return () => ipcRenderer.removeListener('privacy:status', listener);
    },
});
