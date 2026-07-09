local prettier_configs = {
	".prettierrc",
	".prettierrc.js",
	".prettierrc.cjs",
	".prettierrc.mjs",
	".prettierrc.json",
	".prettierrc.json5",
	".prettierrc.yaml",
	".prettierrc.yml",
	".prettierrc.toml",
	"prettier.config.js",
	"prettier.config.cjs",
	"prettier.config.mjs",
	"prettier.config.ts",
}

local function has_prettier_config(ctx)
	return vim.fs.find(prettier_configs, { path = ctx.filename, upward = true })[1] ~= nil
end

return {
	"stevearc/conform.nvim",
	opts = {},
	config = function()
		require("conform").setup({
			formatters_by_ft = {
				lua = { "stylua" },
				javascript = { "prettierd", "prettier", "eslint_d", stop_after_first = true },
				json = { "prettierd", "prettier", "eslint_d", stop_after_first = true },
				javascriptreact = { "prettierd", "prettier", "eslint_d", stop_after_first = true },
				typescript = { "prettierd", "prettier", "eslint_d", stop_after_first = true },
				typescriptreact = { "prettierd", "prettier", "eslint_d", stop_after_first = true },
				markdown = { "prettierd", "prettier", "eslint_d", stop_after_first = true },
			},
			formatters = {
				prettierd = { condition = has_prettier_config },
				prettier = { condition = has_prettier_config },
			},
			format_on_save = {
				timeout_ms = 500,
			},
		})
	end,
}
