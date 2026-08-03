local languages = {
	"c",
	"lua",
	"vim",
	"vimdoc",
	"query",
	"markdown",
	"markdown_inline",
	"javascript",
	"typescript",
	"go",
	"marko",
}

return {
	{
		"nvim-treesitter/nvim-treesitter",
		lazy = false,
		build = ":TSUpdate",
		init = function()
			vim.api.nvim_create_autocmd("User", {
				pattern = "TSUpdate",
				callback = function()
					require("nvim-treesitter.parsers").marko = {
						install_info = {
							path = vim.fn.expand("~/Development/github/marko-tree-sitter/main"),
							queries = "queries",
						},
					}
				end,
			})
		end,
		config = function()
			require("nvim-treesitter").install(languages)

			vim.api.nvim_create_autocmd("FileType", {
				pattern = {
					"c",
					"lua",
					"vim",
					"vimdoc",
					"query",
					"markdown",
					"javascript",
					"typescript",
					"go",
					"marko",
				},
				callback = function()
					vim.treesitter.start()
				end,
			})
		end,
	},
}
