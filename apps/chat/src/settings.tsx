/** 模型设置：配置模型 id / Base URL / API Key，「测试连接」零成本验证（GET /v1/models/{id}），保存即生效。 */
import { useState, useEffect } from 'react';
import { Modal, Form, Input, AutoComplete, Button, Alert, Space, Tag } from 'antd';
import { ApiOutlined, CheckCircleFilled, CloseCircleFilled } from '@ant-design/icons';

export interface LlmConfigView {
  model: string;
  baseUrl: string;
  hasKey: boolean;
  hasToken: boolean;
  enabled: boolean;
  source: 'runtime' | 'env' | 'none';
}

const MODEL_OPTIONS = [
  { value: 'claude-opus-4-8', label: 'claude-opus-4-8 · 最强（推荐）' },
  { value: 'claude-sonnet-4-6', label: 'claude-sonnet-4-6 · 速度/智能均衡' },
  { value: 'claude-haiku-4-5', label: 'claude-haiku-4-5 · 最快最省' },
  { value: 'claude-fable-5', label: 'claude-fable-5 · 旗舰' },
];

export function SettingsModal({
  open, onClose, onSaved,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form] = Form.useForm();
  const [cfg, setCfg] = useState<LlmConfigView | null>(null);
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    if (!open) return;
    setTestResult(null);
    void fetch('/api/agent/llm-config').then((r) => r.json()).then((c: LlmConfigView) => {
      setCfg(c);
      form.setFieldsValue({ model: c.model, baseUrl: c.baseUrl, apiKey: '' });
    });
  }, [open, form]);

  async function test() {
    setTesting(true);
    setTestResult(null);
    const v = form.getFieldsValue();
    const r = await fetch('/api/agent/llm-test', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: v.model, baseUrl: v.baseUrl, apiKey: v.apiKey || undefined }),
    }).then((x) => x.json()).catch((e) => ({ ok: false, error: String(e) }));
    setTestResult(r.ok ? { ok: true, text: `连接成功 · ${r.displayName ?? r.model}` } : { ok: false, text: r.error ?? '失败' });
    setTesting(false);
  }

  async function save() {
    setSaving(true);
    const v = form.getFieldsValue();
    await fetch('/api/agent/llm-config', {
      method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: v.model, baseUrl: v.baseUrl, ...(v.apiKey ? { apiKey: v.apiKey } : {}) }),
    });
    setSaving(false);
    onSaved();
    onClose();
  }

  const credentialHint = cfg?.hasKey || cfg?.hasToken
    ? `已配置凭证（${cfg.source === 'runtime' ? '界面保存' : '环境变量/.env'}），留空保持不变`
    : '粘贴 Anthropic API Key（sk-ant-…）';

  return (
    <Modal
      title={<Space><ApiOutlined /> 模型设置</Space>}
      open={open}
      onCancel={onClose}
      footer={[
        <Button key="test" icon={<ApiOutlined />} loading={testing} onClick={() => void test()}>测试连接</Button>,
        <Button key="save" type="primary" loading={saving} onClick={() => void save()}>保存并生效</Button>,
      ]}
      width={460}
    >
      <Form form={form} layout="vertical" style={{ marginTop: 8 }}>
        <Form.Item label="模型 ID" name="model" extra="任意 Messages API 兼容模型 id，可直接输入自定义值">
          <AutoComplete options={MODEL_OPTIONS} placeholder="claude-opus-4-8" />
        </Form.Item>
        <Form.Item label="API Base URL" name="baseUrl">
          <Input placeholder="https://api.anthropic.com" />
        </Form.Item>
        <Form.Item label={<Space>API Key {cfg?.enabled && <Tag color="green" style={{ margin: 0 }}>已就绪</Tag>}</Space>} name="apiKey">
          <Input.Password placeholder={credentialHint} autoComplete="new-password" />
        </Form.Item>
      </Form>
      {testResult && (
        <Alert
          type={testResult.ok ? 'success' : 'error'}
          showIcon
          icon={testResult.ok ? <CheckCircleFilled /> : <CloseCircleFilled />}
          message={testResult.text}
          style={{ marginTop: 4 }}
        />
      )}
      <div style={{ marginTop: 12, fontSize: 12, color: '#8f959e', lineHeight: 1.7 }}>
        保存后立即生效，无需重启。未配置凭证时运行在剧本演示模式。
      </div>
    </Modal>
  );
}
