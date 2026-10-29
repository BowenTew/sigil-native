const config = {
  '*.{js,mjs,cjs,ts}': ['eslint --fix', 'prettier --write'],
  '*.{css,less,scss}': ['stylelint --fix', 'prettier --write'],
  '*.{json,md,yml,yaml,html}': ['prettier --write'],
}

export default config
