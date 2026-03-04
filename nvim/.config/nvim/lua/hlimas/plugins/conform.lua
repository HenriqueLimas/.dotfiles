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
			format_on_save = {
				-- These options will be passed to conform.format()
				timeout_ms = 500,
			},
		})
	end,
}
