import type {ReactNode} from 'react';
import {ConfigProvider, type ThemeConfig} from 'antd';
import zhCN from 'antd/locale/zh_CN';

const commonToken = {
    borderRadius: 7,
    colorPrimary: '#286fe0',
    colorSuccess: '#178A4C',
    colorWarning: '#C15E1F',
    colorText: '#161B22',
    fontFamily: '"Segoe UI", "Microsoft YaHei", sans-serif',
};

const lightTheme: ThemeConfig = {
    token: {
        ...commonToken,
        colorBgBase: '#FFFFFF',
        colorBgContainer: '#FFFFFF',
        colorBorder: 'rgba(22, 27, 34, 0.16)',
    },
};

const overlayTheme: ThemeConfig = {
    token: {
        ...commonToken,
        colorBgBase: '#F8FAFC',
        colorBgContainer: '#FFFFFF',
        colorBorder: 'rgba(22, 27, 34, 0.16)',
    },
};

export function MeetingMonsterConfigProvider({children, variant}: {children: ReactNode; variant: 'light' | 'overlay'}) {
    return (
        <ConfigProvider
            locale={zhCN}
            theme={variant === 'light' ? lightTheme : overlayTheme}
            getPopupContainer={(triggerNode) => triggerNode?.parentElement ?? document.body}
        >
            {children}
        </ConfigProvider>
    );
}
