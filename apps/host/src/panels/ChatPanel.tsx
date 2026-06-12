/** 对话面板占位（第 5 轮接入 mock Agent 剧本） */
import { Input, Typography, Space } from 'antd';

export function ChatPanel() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', padding: 12 }}>
      <Typography.Text strong style={{ marginBottom: 8 }}>对话搭建</Typography.Text>
      <div style={{
        flex: 1, border: '1px dashed #d0d3d6', borderRadius: 8, display: 'grid',
        placeItems: 'center', color: '#8f959e', fontSize: 13, padding: 16, textAlign: 'center',
      }}>
        <Space direction="vertical" size={4}>
          <span>“做一份周报：DAU 趋势 + 渠道占比，按区域筛选”</span>
          <span style={{ fontSize: 12 }}>mock Agent 对话将在第 5 轮接入</span>
        </Space>
      </div>
      <Input.Search placeholder="描述你的报告需求…" enterButton="发送" disabled style={{ marginTop: 12 }} />
    </div>
  );
}
