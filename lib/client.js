window.__ModuleLoader__.load({
  id: "@local/dsh-minimal-rules",
  factory: (require) => {
    const module = { exports: {} };
    const exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

    const React = require("react");
    const jsx = require("react/jsx-runtime");

    const css = `
      .dsh-minimal-rules-select {
        display: inline-flex;
        align-items: center;
        height: 24px;
        padding: 0 6px;
        border: 1px solid var(--dsw-alias-border-l3, rgba(128,128,128,.35));
        border-radius: 6px;
        color: var(--dsw-alias-label-secondary, #888);
        background: var(--dsw-alias-bg-base, transparent);
        font-size: 11px;
        line-height: 16px;
        white-space: nowrap;
        cursor: pointer;
        flex: none;
      }
      .dsh-minimal-rules-select[data-loading="true"] {
        opacity: .6;
        cursor: default;
      }
    `;
    const styleId = "@local/dsh-minimal-rules/minimal-rules.css";
    if (typeof document !== "undefined" && document.querySelector(`style[data-plugin-css="${styleId}"]`) === null) {
      const tag = document.createElement("style");
      tag.dataset.plugin = "@local/dsh-minimal-rules";
      tag.dataset.pluginCss = styleId;
      tag.textContent = css;
      document.head.appendChild(tag);
    }

    const CONFIG_URL = "/dsh-minimal-rules/config";
    const MODES = ["global", "global+project", "all+creative"];

    function RulesModeSelect() {
      const [mode, setMode] = React.useState("global+project");
      const [loading, setLoading] = React.useState(true);

      React.useEffect(() => {
        let cancelled = false;
        fetch(CONFIG_URL, {
          headers: { Accept: "application/json" },
        })
          .then((response) => {
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            return response.json();
          })
          .then((data) => {
            if (!cancelled && MODES.includes(data?.mode)) setMode(data.mode);
          })
          .catch((error) => {
            console.error("dsh-minimal-rules: load config failed", error);
          })
          .finally(() => {
            if (!cancelled) setLoading(false);
          });
        return () => {
          cancelled = true;
        };
      }, []);

      const changeMode = async (event) => {
        const next = event.target.value;
        if (!MODES.includes(next)) return;
        const previous = mode;
        setMode(next);
        try {
          const response = await fetch(CONFIG_URL, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Accept: "application/json",
            },
            body: JSON.stringify({ mode: next }),
          });
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          const data = await response.json();
          if (MODES.includes(data?.mode)) setMode(data.mode);
        } catch (error) {
          console.error("dsh-minimal-rules: save config failed", error);
          setMode(previous);
        }
      };

      return jsx.jsx("select", {
        className: "dsh-minimal-rules-select",
        value: mode,
        disabled: loading,
        "data-loading": loading ? "true" : "false",
        "aria-label": "规则注入模式",
        title: "规则注入模式",
        onChange: changeMode,
        children: MODES.map((item) =>
          jsx.jsx("option", { value: item, children: item }, item)
        ),
      });
    }

    const inject = ["slots"];

    function apply(ctx) {
      ctx.inject(["slots"], (scope) => {
        scope.slots.inject("conversation.input.left", () => scope.slots.register({
          name: "conversation.input.left",
          id: "@local/dsh-minimal-rules:mode",
          order: 100,
          label: "规则注入",
        }, RulesModeSelect));
      });
    }

    exports.inject = inject;
    exports.apply = apply;
    return module.exports;
  },
});
