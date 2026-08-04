# Silk animated background (React Bits)

Arjun: "Background I like" — must incorporate.

Install:

```bash
pnpm dlx shadcn@latest add @react-bits/Silk-JS-CSS
```

Reference usage (exact props from Arjun's inspo — note the sample color is mauve
`#594c5f`; final tint pending Arjun's call, theme is dark blacks / deep blues):

```tsx
<div style={{ width: '1080px', height: '1080px', position: 'relative' }}>
  <Silk
    speed={5}
    scale={1}
    color="#594c5f"
    noiseIntensity={0.3}
    rotation={0.4}
  />
</div>
```
