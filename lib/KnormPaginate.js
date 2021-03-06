const { Knorm } = require('@knorm/knorm');

class KnormPaginate {
  constructor({ name = 'paginate', page = 1, perPage = 10 } = {}) {
    this.name = name;
    this.page = parseInt(page);
    this.perPage = parseInt(perPage);
  }

  updateModel(knorm) {
    const { Model } = knorm;

    class PaginateModel extends Model {
      static async count(options) {
        return this.query.count(options);
      }
    }

    knorm.updateModel(PaginateModel);
  }

  updateQuery(knorm) {
    const { Query } = knorm;
    const defaultPage = this.page;
    const defaultPerPage = this.perPage;

    class PaginateQuery extends Query {
      constructor(model) {
        super(model);

        this.setOption('withPaginationData', true);
      }

      withPaginationData(withPaginationData = true) {
        return this.setOption('withPaginationData', !!withPaginationData);
      }

      page(page) {
        return this.setOption('page', page);
      }

      perPage(perPage) {
        return this.setOption('perPage', parseInt(perPage));
      }

      async fetch(options) {
        this.setOptions(options);

        let { page, perPage } = this.options;
        const { withPaginationData } = this.options;

        if (page === undefined && perPage === undefined) {
          return super.fetch();
        }

        if (page === undefined) {
          page = defaultPage;
        }

        if (perPage === undefined) {
          perPage = defaultPerPage;
        }

        let total;

        if (withPaginationData || page === 'last') {
          const clone = this.clone().unsetOptions([
            'groupBy',
            'orderBy',
            'limit',
            'offset'
          ]);

          if (!clone.hasOption('distinct')) {
            clone.unsetOption('fields');
          }

          total = await clone.count();

          if (page === 'last') {
            page = Math.ceil(total / perPage);
          }
        }

        page = page === 'first' ? 1 : parseInt(page);

        const rows = await super.fetch({
          limit: perPage,
          offset: perPage * (page - 1)
        });

        return withPaginationData ? { total, page, perPage, rows } : rows;
      }

      async prepareSql(sql, options) {
        if (this.config.forCount) {
          const joins = this.getOption('joins');

          if (joins) {
            joins.forEach(join => {
              // disable fields on joins if none have been set
              if (!join.hasOption('fields')) {
                join.fields(false);
              }

              // enable recursively disabling joined fields
              join.config.forCount = true;
            });
          }
        }

        return super.prepareSql(sql, options);
      }

      prepareCountFields() {
        let fields = [];

        if (this.options.fields) {
          fields = fields.concat(Object.values(this.options.fields));
          this.unsetOption('fields');
        }

        fields = fields.length
          ? fields.map(this.getColumn, this).join(', ')
          : '*';

        if (this.options.distinct) {
          fields = `DISTINCT ${fields}`;
          this.unsetOption('distinct');
        }

        return this.fields({ count: `COUNT(${fields})` });
      }

      async count(options) {
        this.setOptions(options);
        this.prepareCountFields();

        this.config.forCount = true;

        const rows = await super.fetch();
        const count = parseInt(rows[0].count);

        if (!count && this.options.require) {
          throw new this.constructor.NoRowsCountedError({ query: this });
        }

        return count;
      }
    }

    PaginateQuery.NoRowsCountedError = class NoRowsCountedError extends Query.NoRowsError {};

    knorm.updateQuery(PaginateQuery);
  }

  init(knorm) {
    if (!knorm) {
      throw new this.constructor.KnormPaginateError(
        'no Knorm instance provided'
      );
    }

    if (!(knorm instanceof Knorm)) {
      throw new this.constructor.KnormPaginateError(
        'invalid Knorm instance provided'
      );
    }

    this.updateModel(knorm);
    this.updateQuery(knorm);
  }
}

KnormPaginate.KnormPaginateError = class KnormPaginateError extends Knorm.KnormError {};

module.exports = KnormPaginate;
