const pageSizes = Object.freeze([5, 10, 20, 50, 100]);
const defaultSize = 10;
const digits = value => typeof value === 'string' && /^\d+$/.test(value);

function pageSize(query) {
  const requested = digits(query?.pageSize) ? Number(query.pageSize) : defaultSize;
  return pageSizes.includes(requested) ? requested : defaultSize;
}

function paginate(query, totalRecord) {
  const limit = pageSize(query);
  const totalPage = Math.ceil(totalRecord / limit);
  const requested = digits(query?.page) ? Number(query.page) : 1;
  const page = Math.max(1, Math.min(requested, totalPage));
  return { limit, page, skip: (page - 1) * limit, totalRecord, totalPage, pageSizes };
}

module.exports = { paginate };
