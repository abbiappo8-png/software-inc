/**
 * Preload — puente seguro entre renderer y main.
 * Expone window.api con métodos concretos (sin ipcRenderer crudo).
 */
import { contextBridge, ipcRenderer } from 'electron'
import type { AppApi } from '@shared/types/api'

const call = (channel: string, ...args: unknown[]) => ipcRenderer.invoke(channel, ...args)

const api: AppApi = {
  auth: {
    status: () => call('auth:status'),
    hasPin: () => call('auth:hasPin'),
    setPin: (pin) => call('auth:setPin', pin),
    verify: (pin) => call('auth:verify', pin),
    change: (current, next) => call('auth:change', current, next)
  },
  import: {
    pickFile: () => call('import:pickFile'),
    run: (path) => call('import:run', path)
  },
  persons: {
    list: (filter) => call('persons:list', filter),
    count: (filter) => call('persons:count', filter),
    get: (id) => call('persons:get', id),
    create: (input) => call('persons:create', input),
    update: (id, input) => call('persons:update', id, input),
    remove: (id) => call('persons:remove', id),
    setPhoto: (id, dataBase64) => call('persons:setPhoto', id, dataBase64),
    photoDataUrl: (id) => call('persons:photoDataUrl', id)
  },
  catalog: {
    listServices: (onlyActive) => call('catalog:listServices', onlyActive),
    createService: (s) => call('catalog:createService', s),
    updateService: (id, s) => call('catalog:updateService', id, s),
    listEquipment: (onlyActive) => call('catalog:listEquipment', onlyActive),
    createEquipment: (e) => call('catalog:createEquipment', e),
    updateEquipment: (id, e) => call('catalog:updateEquipment', id, e)
  },
  transactions: {
    list: (filter) => call('tx:list', filter),
    preview: (input) => call('tx:preview', input),
    create: (input) => call('tx:create', input),
    update: (id, input) => call('tx:update', id, input),
    checkout: (id, endMin) => call('tx:checkout', id, endMin),
    remove: (id) => call('tx:remove', id)
  },
  bar: {
    listProducts: () => call('bar:listProducts'),
    createProduct: (input) => call('bar:createProduct', input),
    updateProduct: (id, input) => call('bar:updateProduct', id, input),
    restock: (input) => call('bar:restock', input),
    createSale: (input) => call('bar:createSale', input),
    listSales: (from, to) => call('bar:listSales', from, to)
  },
  expenses: {
    list: (from, to) => call('expenses:list', from, to),
    create: (input) => call('expenses:create', input),
    update: (id, input) => call('expenses:update', id, input),
    remove: (id) => call('expenses:remove', id)
  },
  bills: {
    preview: (clientId, opts) => call('bills:preview', clientId, opts),
    save: (clientId, opts) => call('bills:save', clientId, opts),
    markPaid: (billId) => call('bills:markPaid', billId),
    pdf: (billId) => call('bills:pdf', billId),
    email: (billId) => call('bills:email', billId)
  },
  settlements: {
    preview: (professorId, year, month) => call('settlements:preview', professorId, year, month),
    save: (professorId, year, month) => call('settlements:save', professorId, year, month),
    markPaid: (professorId, year, month) => call('settlements:markPaid', professorId, year, month),
    pdf: (professorId, year, month) => call('settlements:pdf', professorId, year, month)
  },
  finance: {
    dailyCashflow: (from, to) => call('finance:dailyCashflow', from, to),
    monthSummary: (year, month) => call('finance:monthSummary', year, month),
    ageStats: () => call('finance:ageStats'),
    yearBalance: () => call('finance:yearBalance'),
    dashboard: () => call('finance:dashboard')
  },
  plans: {
    list: () => call('plans:list'),
    get: (id) => call('plans:get', id),
    create: (title, personId, principal, startDate) => call('plans:create', title, personId, principal, startDate),
    addInstallment: (planId, paidDate, amount, comment) => call('plans:addInstallment', planId, paidDate, amount, comment)
  },
  settings: {
    getCompany: () => call('settings:getCompany'),
    setCompany: (cfg) => call('settings:setCompany', cfg),
    getSmtp: () => call('settings:getSmtp'),
    setSmtp: (cfg) => call('settings:setSmtp', cfg),
    testSmtp: () => call('settings:testSmtp'),
    setBarDiscount: (pct) => call('settings:setBarDiscount', pct),
    getBarDiscount: () => call('settings:getBarDiscount')
  },
  forms: {
    list: () => call('forms:list'),
    saveConfig: (formsCfg) => call('forms:saveConfig', formsCfg),
    sync: (formKey) => call('forms:sync', formKey),
    responses: (formKey, status) => call('forms:responses', formKey, status),
    convert: (responseId, kind, edited) => call('forms:convert', responseId, kind, edited),
    ignore: (responseId) => call('forms:ignore', responseId)
  },
  files: {
    list: () => call('files:list'),
    add: () => call('files:add'),
    remove: (name) => call('files:remove', name),
    open: (name) => call('files:open', name),
    read: (name) => call('files:read', name)
  },
  backup: {
    create: () => call('backup:create'),
    list: () => call('backup:list')
  },
  exports: {
    balance: (from, to) => call('exports:balance', from, to),
    monthSummary: (year, month) => call('exports:monthSummary', year, month),
    openFolder: () => call('exports:openFolder')
  }
}

contextBridge.exposeInMainWorld('api', api)
