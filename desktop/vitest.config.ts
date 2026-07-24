import {defineConfig} from 'vitest/config';
import path from 'node:path';

export default defineConfig({
    root: path.resolve(__dirname, '..'),
    resolve: {
        alias: {
            react: path.resolve(__dirname, 'node_modules/react'),
            'react-dom': path.resolve(__dirname, 'node_modules/react-dom'),
            '@testing-library/react': path.resolve(__dirname, 'node_modules/@testing-library/react'),
            '@testing-library/user-event': path.resolve(__dirname, 'node_modules/@testing-library/user-event'),
        },
    },
});
