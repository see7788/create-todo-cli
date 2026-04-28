pnpm-create 让ai写个，package要交互name、description，均默认私有、github仓库地址、licensez最宽松

判断所处位置是否pnpm根
  非根多个选项：创建子仓库(无git，tsconfig、typescript依赖、tsx依赖，main:src/index.ts)|create-todo-cli的选项
    是根多出一个pnpmroot根选项 （
     git .pnpm-store/** **/node_modules/** **/dist/** **/**_bak/ **/**.bak
     pnpm-workspace.yaml packages: - "libs/*"- "apps/*"- '**/!dist/**'，
     创建gitignore
     .npmrc store-dir=./.pnpm-store
     package.json默认 "workspaces": [ "libs", "apps"],pnpm：:{overrides:{tsx,typescript}}
     publish.yml，默认有npmjs任务发布所有后缀是lib的包(包名称=`@see7788/${pnpm名称}-${包含lib的包名称}`、github仓库地址 author，"main": "src/index.ts",关键字用项目里关键类名、文件名不含后缀)
     ）
