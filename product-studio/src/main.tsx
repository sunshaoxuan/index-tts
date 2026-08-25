import React from 'react';
import ReactDOM from 'react-dom/client';
import { ConfigProvider, theme } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import App from './App';
import './styles.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ConfigProvider locale={zhCN} variant="underlined" theme={{
      algorithm: theme.darkAlgorithm,
      token: {
        colorPrimary: '#ffedd7', colorInfo: '#ffedd7', colorText: '#ffedd7',
        colorTextSecondary: '#ffedd7', colorTextTertiary: '#ffedd7', colorTextQuaternary: '#ffedd7',
        colorSuccess: '#ffedd7', colorWarning: '#ffedd7', colorError: '#ffedd7',
        colorBgBase: '#100904', colorBgLayout: '#100904',
        colorBgContainer: '#100904', colorBorder: '#40372e', colorSplit: '#40372e',
        borderRadius: 12, borderRadiusLG: 12, boxShadow: 'none', boxShadowSecondary: 'none',
        fontFamily: 'Inter, Söhne, Neue Haas Grotesk, system-ui, sans-serif',
      },
      components: {
        Button: { primaryColor: '#ffedd7', colorPrimary: '#382416', colorPrimaryHover: '#4a3020', borderRadius: 23 },
        Table: { headerBg: '#100904', headerColor: '#ffedd7', rowHoverBg: '#20140c', borderColor: '#40372e' },
        Tabs: { itemColor: '#ffedd7', itemSelectedColor: '#ffedd7', inkBarColor: '#ffedd7' },
      },
    }}>
      <App />
    </ConfigProvider>
  </React.StrictMode>,
);
